import { EventEmitter } from "events";
import { PublicKey } from "@solana/web3.js";
import { TxLineClient } from "../clients/txline-client";
import { Config } from "../config";
import {
  SoccerEvent,
  SoccerAction,
  GoalType,
  StatusId,
  gameStateToStatusId,
} from "./event-parser";
import type { FixtureRecord, ScoresRecord } from "@swingkiddo/txodds-client/dist/types";

// ── Interfaces ──

export interface MatchState {
  fixtureId: number;
  matchPda: PublicKey;
  matchPdaBump: number;
  status: StatusId;
  currentPeriod: string;
  homeScore: number;
  awayScore: number;
  matchClockMs: number;
  lastEventAt: number;
  marketCounter: number;
  participants: { home: string; away: string };
  startTime?: number;
  stats: Record<number, number>;
}

export interface FixtureWatcherEvents {
  match_start: [state: MatchState];
  match_end: [state: MatchState];
  match_half: [state: MatchState];
  match_interrupted: [state: MatchState];
  match_pe: [state: MatchState];
  match_fpe: [state: MatchState];
  score_changed: [state: MatchState];
}

// ── Helpers ──

function toLeBytes64(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

const STATUS_TO_PERIOD: Record<number, string> = {
  [StatusId.NotStarted]: "NS",
  [StatusId.FirstHalf]: "H1",
  [StatusId.HalfTime]: "HT",
  [StatusId.SecondHalf]: "H2",
  [StatusId.FullTime]: "FT",
  [StatusId.WaitingExtraTime]: "WE",
  [StatusId.ExtraTimeFirstHalf]: "ET1",
  [StatusId.ExtraTimeHalfTime]: "ETHT",
  [StatusId.ExtraTimeSecondHalf]: "ET2",
  [StatusId.FinishedAfterExtraTime]: "FET",
  [StatusId.WaitingPenaltyShootout]: "WP",
  [StatusId.PenaltyShootout]: "PE",
  [StatusId.FinishedAfterPenaltyShootout]: "FPE",
  [StatusId.Interrupted]: "I",
  [StatusId.Abandoned]: "A",
  [StatusId.Cancelled]: "C",
};

function statusEndsMatch(status: StatusId): boolean {
  return (
    status === StatusId.FullTime ||
    status === StatusId.FinishedAfterExtraTime ||
    status === StatusId.FinishedAfterPenaltyShootout
  );
}

function statusInterruptsMatch(status: StatusId): boolean {
  return (
    status === StatusId.Interrupted ||
    status === StatusId.Abandoned ||
    status === StatusId.Cancelled
  );
}

// ── FixtureWatcher ──

export class FixtureWatcher extends EventEmitter {
  private matches: Map<number, MatchState> = new Map();
  private client: TxLineClient;
  private config: Config;

  constructor(client: TxLineClient, config: Config) {
    super();
    this.client = client;
    this.config = config;
  }

  // ── Static PDA derivation ──

  static deriveMatchPda(fixtureId: number, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("match"), toLeBytes64(fixtureId)],
      programId,
    );
  }

  static deriveConfigPda(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  }

  // ── Fixture loading ──

  async loadFixture(fixtureId: number): Promise<MatchState> {
    const [matchPda, matchPdaBump] = FixtureWatcher.deriveMatchPda(
      fixtureId,
      this.config.kicktickProgramId,
    );

    const [scores] = await Promise.all([
      this.client.getScoresSnapshot(fixtureId),
    ]);

    let startTime: number | undefined;
    let participants: { home: string; away: string } = { home: "", away: "" };

    try {
      const fixtures = await this.client.getFixtures();
      const fixture = fixtures.find(
        (f: FixtureRecord) => f.FixtureId === fixtureId,
      );
      if (fixture) {
        startTime = fixture.StartTime;
        participants = {
          home: fixture.Participant1IsHome
            ? fixture.Participant1
            : fixture.Participant2,
          away: fixture.Participant1IsHome
            ? fixture.Participant2
            : fixture.Participant1,
        };
      }
    } catch {
      // Non-critical — proceed with empty participant names
    }

    const records = scores as any[];
    const bestRecord = records.length > 0
      ? records.reduce((best, r) => ((r?.seq ?? r?.Seq ?? 0) > (best?.seq ?? best?.Seq ?? 0) ? r : best))
      : null;
    const status = bestRecord?.gameState ?? bestRecord?.StatusId ?? StatusId.NotStarted;

    const state: MatchState = {
      fixtureId,
      matchPda,
      matchPdaBump,
      status,
      currentPeriod: STATUS_TO_PERIOD[status] || "NS",
      homeScore: bestRecord?.homeScore ?? bestRecord?.Score?.Participant1?.Total?.Goals ?? 0,
      awayScore: bestRecord?.awayScore ?? bestRecord?.Score?.Participant2?.Total?.Goals ?? 0,
      matchClockMs: bestRecord?.clock?.seconds != null ? bestRecord.clock.seconds * 1000 : bestRecord?.Clock?.Seconds != null ? bestRecord.Clock.Seconds * 1000 : 0,
      lastEventAt: (bestRecord?.ts ?? bestRecord?.Ts) ? (bestRecord.ts ?? bestRecord.Ts) * 1000 : Date.now(),
      marketCounter: 0,
      participants,
      startTime,
      stats: bestRecord?.stats ?? {},
    };

    this.matches.set(fixtureId, state);
    return state;
  }

  // ── Event processing ──

  registerSyntheticFixture(
    fixtureId: number,
    home: string,
    away: string,
    status: StatusId = StatusId.FirstHalf,
  ): MatchState {
    const [matchPda, matchPdaBump] = FixtureWatcher.deriveMatchPda(fixtureId, this.config.kicktickProgramId);
    const state: MatchState = {
      fixtureId, matchPda, matchPdaBump, status,
      currentPeriod: STATUS_TO_PERIOD[status] || "NS",
      homeScore: 0, awayScore: 0, matchClockMs: 0, lastEventAt: Date.now(),
      marketCounter: 0, participants: { home, away },
      stats: {},
    };
    this.matches.set(fixtureId, state);
    return state;
  }

  processEvent(event: SoccerEvent, fixtureId: number): MatchState | undefined {
    const state = this.matches.get(fixtureId);
    if (!state) return undefined;

    state.lastEventAt = Date.now();

    switch (event.action) {
      case SoccerAction.Status:
        this.handleStatusChange(event, state);
        break;

      case SoccerAction.Goal:
        this.handleGoal(event, state);
        break;

      case SoccerAction.ScoreAdjustment:
        this.handleScoreAdjustment(event, state);
        break;
    }

    return state;
  }

  removeFixture(fixtureId: number): void {
    this.matches.delete(fixtureId);
  }

  getFixtureState(fixtureId: number): MatchState | undefined {
    return this.matches.get(fixtureId);
  }

  getAllFixtures(): MatchState[] {
    return Array.from(this.matches.values());
  }

  /** Reconstruct triggerable score changes from ordered REST score updates. */
  applyScoreUpdate(update: ScoresRecord): { state: MatchState; events: SoccerEvent[] } | undefined {
    const state = this.matches.get(update.fixtureId);
    if (!state) return undefined;
    const events: SoccerEvent[] = [];
    const nextStatus = Number.isInteger(update.gameState) ? update.gameState as StatusId : undefined;
    if (nextStatus && nextStatus !== state.status) {
      this.handleStatusChange({ action: SoccerAction.Status, statusId: nextStatus }, state);
      events.push({ action: SoccerAction.Status, statusId: nextStatus, seq: update.seq });
    }

    for (const [participant, before, after] of [
      [1, state.homeScore, update.homeScore],
      [2, state.awayScore, update.awayScore],
    ] as const) {
      for (let count = before; count < after; count++) {
        events.push({ action: SoccerAction.Goal, participant, goalType: GoalType.Other, seq: update.seq });
      }
    }

    const statEvents: ReadonlyArray<[number, SoccerAction, 1 | 2]> = [
      [7, SoccerAction.Corner, 1], [8, SoccerAction.Corner, 2],
      [3, SoccerAction.YellowCard, 1], [4, SoccerAction.YellowCard, 2],
      [5, SoccerAction.RedCard, 1], [6, SoccerAction.RedCard, 2],
    ];
    for (const [statKey, action, participant] of statEvents) {
      const before = state.stats[statKey] ?? 0;
      const after = update.stats[statKey] ?? before;
      for (let count = before; count < after; count++) {
        if (action === SoccerAction.RedCard) {
          events.push({ action, participant, redCardType: "StraightRed", seq: update.seq });
        } else if (action === SoccerAction.YellowCard) {
          events.push({ action, participant, seq: update.seq });
        } else {
          events.push({ action, participant, seq: update.seq });
        }
      }
    }

    const scoreChanged = state.homeScore !== update.homeScore || state.awayScore !== update.awayScore;
    state.homeScore = update.homeScore;
    state.awayScore = update.awayScore;
    state.stats = { ...update.stats };
    state.lastEventAt = update.ts * 1000;
    if (scoreChanged) this.emit("score_changed", state);
    return { state, events };
  }

  // ── Internal event handlers ──

  private handleStatusChange(
    event: { action: SoccerAction.Status; participant?: 1 | 2; statusId: StatusId },
    state: MatchState,
  ): void {
    const newStatus = event.statusId;
    const prevStatus = state.status;

    if (prevStatus === newStatus) return;

    state.status = newStatus;
    state.currentPeriod = STATUS_TO_PERIOD[newStatus] || "NS";

    if (newStatus === StatusId.FirstHalf) {
      state.marketCounter++;
      this.emit("match_start", state);
    }

    if (newStatus === StatusId.HalfTime) {
      state.marketCounter++;
      this.emit("match_half", state);
    }

    if (newStatus === StatusId.PenaltyShootout) {
      state.marketCounter++;
      this.emit("match_pe", state);
    }

    if (statusEndsMatch(newStatus)) {
      this.emit("match_end", state);
    }

    if (newStatus === StatusId.FinishedAfterPenaltyShootout) {
      this.emit("match_fpe", state);
    }

    if (statusInterruptsMatch(newStatus)) {
      this.emit("match_interrupted", state);
    }
  }

  private handleGoal(
    event: { action: SoccerAction.Goal; participant?: 1 | 2 },
    state: MatchState,
  ): void {
    if (event.participant === 1) {
      state.homeScore++;
    } else if (event.participant === 2) {
      state.awayScore++;
    }
    this.emit("score_changed", state);
  }

  private handleScoreAdjustment(
    event: { action: SoccerAction.ScoreAdjustment; participant?: 1 | 2; score: Record<string, unknown> },
    state: MatchState,
  ): void {
    const score = event.score;
    const p1Goals = (score as any)?.Participant1?.Total?.Goals;
    const p2Goals = (score as any)?.Participant2?.Total?.Goals;
    if (typeof p1Goals === "number") state.homeScore = p1Goals;
    if (typeof p2Goals === "number") state.awayScore = p2Goals;
    this.emit("score_changed", state);
  }
}
