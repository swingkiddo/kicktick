import { EventEmitter } from "events";
import {
  SoccerEvent,
  SoccerAction,
  MarketType,
  StatusId,
  GoalEvent,
  CornerEvent,
  YellowCardEvent,
  RedCardEvent,
  PenaltyOutcomeEvent,
  VarCheckEvent,
  VarEndEvent,
  StatusChangeEvent,
} from "./event-parser";
import type { MatchState } from "./fixture-watcher";

export enum MarketSide {
  Yes = 1,
  No = 2,
  NoGoal = 3,
  Home = 1,
  Away = 2,
}

export type TriggerAction =
  | { type: "open_market"; fixtureId: number; matchPda: string; marketSeq: number; marketType: MarketType; lockSeconds: number; deadlineSeconds: number; params?: MarketOpenParams; triggerSseSeq?: number }
  | { type: "resolve_market_onchain"; fixtureId: number; matchPda: string; marketSeq: number; marketType: MarketType; settlementSeq: number; targetStatKey?: number }
  | { type: "resolve_market_offchain"; fixtureId: number; matchPda: string; marketSeq: number; marketType: MarketType; outcome: "Yes" | "No" | "Home" | "Away" | "NoGoal" | "Cancelled" }
  | { type: "confirm_market"; fixtureId: number; matchPda: string; marketSeq: number; marketType: MarketType };

export interface MarketTracker {
  marketSeq: number;
  marketType: MarketType;
  status: "open" | "settling" | "settled";
  openedAt: number;
  expiresAt: number;
  settledAt?: number;
  triggerEvent?: SoccerEvent;
}

export interface MarketOpenParams {
  participant: number;
  period: number;
  baselineA: number;
  baselineB: number;
}

export const MIN_MARKET_DURATION = 15;
export const MAX_MARKET_DURATION = 300;
export const DEFAULT_DEADLINE_SECONDS = 120;
export const MARKET_TIMINGS: Record<string, { lock: number; deadline: number }> = {
  NextGoalSide:        { lock: 30, deadline: 90 },
  GoalInWindow:        { lock: 15, deadline: 300 },
  NextCorner:          { lock: 30, deadline: 120 },
  CornerInWindow:      { lock: 15, deadline: 180 },
  NextYellowCard:      { lock: 30, deadline: 120 },
  YellowCardInWindow:  { lock: 15, deadline: 300 },
  RedCardInMatch:      { lock: 15, deadline: 99999 },
  PenaltyShootoutShot: { lock: 10, deadline: 30 },
  PenaltyShot:         { lock: 15, deadline: 90 },
  VARCheck:            { lock: 15, deadline: 120 },
};

function statusEndsMatch(status: StatusId): boolean {
  return (
    status === StatusId.FullTime ||
    status === StatusId.FinishedAfterExtraTime ||
    status === StatusId.FinishedAfterPenaltyShootout
  );
}

function periodForState(state: MatchState): number {
  switch (state.currentPeriod) {
    case "H2": return 1000;
    case "ET1": return 2000;
    case "ET2": return 3000;
    case "PE": return 5000;
    default: return 0;
  }
}

function statKeysForMarket(marketType: MarketType): [number, number] {
  switch (marketType) {
    case MarketType.NextGoalSide:
    case MarketType.GoalInWindow: return [1, 2];
    case MarketType.NextCorner:
    case MarketType.CornerInWindow: return [7, 8];
    case MarketType.NextYellowCard:
    case MarketType.YellowCardInWindow: return [3, 4];
    case MarketType.RedCardInMatch: return [5, 6];
    case MarketType.PenaltyShootoutShot: return [5001, 5002];
    default: return [0, 0];
  }
}

interface FixtureState {
  marketCounter: number;
  markets: Map<number, MarketTracker>;
  matchPda: string;
  penaltyShootoutMode: boolean;
  penaltyShootoutMarket: number;
  cronWindowsEnabled: boolean;
  lastCronWindow: Map<string, number>;
}

export class MarketTrigger extends EventEmitter {
  private fixtures: Map<number, FixtureState> = new Map();
  private lastSeenSeq: Map<number, number> = new Map();

  constructor() {
    super();
  }

  getNextMarketSeq(fixtureId: number): number {
    const f = this.getOrCreateFixture(fixtureId);
    const id = f.marketCounter;
    f.marketCounter++;
    return id;
  }

  getActiveMarkets(fixtureId: number): MarketTracker[] {
    const f = this.fixtures.get(fixtureId);
    if (!f) return [];
    return Array.from(f.markets.values()).filter(
      (r) => r.status === "open",
    );
  }

  registerSyntheticMarket(fixtureId: number, marketSeq: number, marketType: MarketType, expiresAt: number): void {
    const f = this.getOrCreateFixture(fixtureId);
    f.marketCounter = Math.max(f.marketCounter, marketSeq + 1);
    f.markets.set(marketSeq, { marketSeq, marketType, status: "open", openedAt: Date.now(), expiresAt });
  }

  processEvent(event: SoccerEvent, fixtureId: number, currentMatchState: MatchState): void {
    const f = this.getOrCreateFixture(fixtureId);
    f.matchPda = currentMatchState.matchPda.toBase58();

    const seq = (event as any).seq;
    if (typeof seq === "number") {
      this.lastSeenSeq.set(fixtureId, seq);
    }

    const actions: TriggerAction[] = [];

    switch (event.action) {
      case SoccerAction.Goal:
        this.handleGoal(event as GoalEvent, fixtureId, currentMatchState, actions);
        break;
      case SoccerAction.Corner:
        this.handleCorner(event as CornerEvent, fixtureId, currentMatchState, actions);
        break;
      case SoccerAction.YellowCard:
        this.handleYellowCard(event as YellowCardEvent, fixtureId, currentMatchState, actions);
        break;
      case SoccerAction.RedCard:
        this.handleRedCard(event as RedCardEvent, fixtureId, currentMatchState, actions);
        break;
      case SoccerAction.Penalty:
        this.handlePenalty(fixtureId, currentMatchState, actions);
        break;
      case SoccerAction.PenaltyOutcome:
        this.handlePenaltyOutcome(event as PenaltyOutcomeEvent, fixtureId, currentMatchState, actions);
        break;
      case SoccerAction.Var:
        this.handleVar(event as VarCheckEvent, fixtureId, currentMatchState, actions);
        break;
      case SoccerAction.VarEnd:
        this.handleVarEnd(event as VarEndEvent, fixtureId, currentMatchState, actions);
        break;
      case SoccerAction.Status:
        this.handleStatus(event as StatusChangeEvent, fixtureId, currentMatchState, actions);
        break;
    }

    this.checkCronWindows(fixtureId, currentMatchState, actions);

    if (actions.length > 0) {
      this.emit("actions", actions);
    }
  }

  checkTimeouts(fixtureId: number): TriggerAction[] {
    const f = this.fixtures.get(fixtureId);
    if (!f) return [];
    if (!f.matchPda) return [];

    const actions: TriggerAction[] = [];
    const now = Date.now();

    for (const [, market] of f.markets) {
      if (market.status !== "open") {
        if (market.status === "settling" && market.settledAt) {
          actions.push({
            type: "confirm_market",
            fixtureId,
            matchPda: f.matchPda,
            marketSeq: market.marketSeq,
            marketType: market.marketType,
          });
          market.status = "settled";
        }
        continue;
      }

      if (now <= market.expiresAt) continue;

      market.status = "settling";
      market.settledAt = now;

      const seq = this.lastSeenSeq.get(fixtureId) ?? 0;

      switch (market.marketType) {
        case MarketType.NextGoalSide:
        case MarketType.NextCorner:
        case MarketType.NextYellowCard:
          actions.push({
            type: "resolve_market_onchain",
            fixtureId,
            matchPda: f.matchPda,
            marketSeq: market.marketSeq,
            marketType: market.marketType,
            settlementSeq: seq,
          });
          break;

        case MarketType.GoalInWindow:
        case MarketType.CornerInWindow:
        case MarketType.YellowCardInWindow:
        case MarketType.PenaltyShootoutShot:
          actions.push({
            type: "resolve_market_onchain",
            fixtureId,
            matchPda: f.matchPda,
            marketSeq: market.marketSeq,
            marketType: market.marketType,
            settlementSeq: seq,
          });
          break;

        case MarketType.PenaltyShot:
          actions.push({
            type: "resolve_market_offchain",
            fixtureId,
            matchPda: f.matchPda,
            marketSeq: market.marketSeq,
            marketType: market.marketType,
            outcome: "No",
          });
          break;
        case MarketType.VARCheck:
          actions.push({
            type: "resolve_market_offchain",
            fixtureId,
            matchPda: f.matchPda,
            marketSeq: market.marketSeq,
            marketType: market.marketType,
            outcome: "No",
          });
          break;

        default:
          break;
      }
    }

    return actions;
  }

  startCronWindows(fixtureId: number): void {
    const f = this.getOrCreateFixture(fixtureId);
    f.cronWindowsEnabled = true;
  }

  stopCronWindows(fixtureId: number): void {
    const f = this.fixtures.get(fixtureId);
    if (f) f.cronWindowsEnabled = false;
  }

  private getOrCreateFixture(fixtureId: number): FixtureState {
    let f = this.fixtures.get(fixtureId);
    if (!f) {
      f = {
        marketCounter: 1,
        markets: new Map(),
        matchPda: "",
        penaltyShootoutMode: false,
        penaltyShootoutMarket: 0,
        cronWindowsEnabled: false,
        lastCronWindow: new Map(),
      };
      this.fixtures.set(fixtureId, f);
    }
    return f;
  }

  private findOpenMarket(f: FixtureState, marketType: MarketType): MarketTracker | undefined {
    for (const [, market] of f.markets) {
      if (
        market.marketType === marketType &&
        market.status === "open"
      ) {
        return market;
      }
    }
    return undefined;
  }

  private openMarket(
    fixtureId: number,
    marketType: MarketType,
    state: MatchState,
    actions: TriggerAction[],
    triggerEvent?: SoccerEvent,
  ): void {
    const f = this.getOrCreateFixture(fixtureId);
    const marketSeq = this.getNextMarketSeq(fixtureId);
    const timings = MARKET_TIMINGS[marketType] || {
      lock: 15,
      deadline: DEFAULT_DEADLINE_SECONDS,
    };
    const now = Date.now();
    const deadlineSec = Math.min(timings.deadline, MAX_MARKET_DURATION);

    const tracker: MarketTracker = {
      marketSeq,
      marketType,
      status: "open",
      openedAt: now,
      expiresAt: now + deadlineSec * 1000,
      triggerEvent,
    };

    f.markets.set(marketSeq, tracker);

    actions.push({
      type: "open_market",
      fixtureId,
      matchPda: state.matchPda.toBase58(),
      marketSeq,
      marketType,
      lockSeconds: timings.lock,
      deadlineSeconds: deadlineSec,
      params: (() => {
        const [keyA, keyB] = statKeysForMarket(marketType);
        return {
          participant: 0,
          period: periodForState(state),
          baselineA: state.stats[keyA] ?? 0,
          baselineB: state.stats[keyB] ?? 0,
        };
      })(),
    });
  }

  private handleGoal(
    event: GoalEvent,
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    const f = this.getOrCreateFixture(fixtureId);

    const current = this.findOpenMarket(f, MarketType.NextGoalSide);
    if (current) {
      current.status = "settling";
      current.settledAt = Date.now();
      actions.push({
        type: "resolve_market_offchain",
        fixtureId,
        matchPda: f.matchPda,
        marketSeq: current.marketSeq,
        marketType: MarketType.NextGoalSide,
        settlementSeq: event.seq!,
        targetStatKey: event.participant === 1 ? 1 : 2,
      });
    }

    this.openMarket(fixtureId, MarketType.NextGoalSide, state, actions, event);
  }

  private handleCorner(
    event: CornerEvent,
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    const f = this.getOrCreateFixture(fixtureId);

    const current = this.findOpenMarket(f, MarketType.NextCorner);
    if (current) {
      current.status = "settling";
      current.settledAt = Date.now();
      actions.push({
        type: "resolve_market_onchain",
        fixtureId,
        matchPda: f.matchPda,
        marketSeq: current.marketSeq,
        marketType: MarketType.NextCorner,
        settlementSeq: event.seq!,
        targetStatKey: event.participant === 1 ? 7 : 8,
      });
    }

    this.openMarket(fixtureId, MarketType.NextCorner, state, actions, event);
  }

  private handleYellowCard(
    event: YellowCardEvent,
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    const f = this.getOrCreateFixture(fixtureId);

    const current = this.findOpenMarket(f, MarketType.NextYellowCard);
    if (current) {
      current.status = "settling";
      current.settledAt = Date.now();
      actions.push({
        type: "resolve_market_onchain",
        fixtureId,
        matchPda: f.matchPda,
        marketSeq: current.marketSeq,
        marketType: MarketType.NextYellowCard,
        settlementSeq: event.seq!,
        targetStatKey: event.participant === 1 ? 3 : 4,
      });
    }

    this.openMarket(fixtureId, MarketType.NextYellowCard, state, actions, event);
  }

  private handleRedCard(
    event: RedCardEvent,
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    const f = this.getOrCreateFixture(fixtureId);

    const current = this.findOpenMarket(f, MarketType.RedCardInMatch);
    if (current) {
      current.status = "settling";
      current.settledAt = Date.now();
      actions.push({
        type: "resolve_market_onchain",
        fixtureId,
        matchPda: f.matchPda,
        marketSeq: current.marketSeq,
        marketType: MarketType.RedCardInMatch,
        settlementSeq: event.seq!,
        targetStatKey: 5,
      });
    }
  }

  private handlePenalty(
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    this.openMarket(fixtureId, MarketType.PenaltyShot, state, actions);
  }

  private handlePenaltyOutcome(
    event: PenaltyOutcomeEvent,
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    const f = this.getOrCreateFixture(fixtureId);

    if (event.outcome === "Retake") {
      const current = this.findOpenMarket(f, MarketType.PenaltyShot);
      if (current) {
        current.expiresAt += 60_000;
      }
      return;
    }

    const current = this.findOpenMarket(f, MarketType.PenaltyShot);
    if (current) {
      current.status = "settling";
      current.settledAt = Date.now();
      actions.push({
        type: "resolve_market_offchain",
        fixtureId,
        matchPda: f.matchPda,
        marketSeq: current.marketSeq,
        marketType: MarketType.PenaltyShot,
        outcome: event.outcome === "Scored" ? "Yes" : "No",
      });
    }

    if (f.penaltyShootoutMode) {
      const soMarket = this.findOpenMarket(f, MarketType.PenaltyShootoutShot);
      if (soMarket) {
        soMarket.status = "settling";
        soMarket.settledAt = Date.now();
        actions.push({
          type: "resolve_market_onchain",
          fixtureId,
          matchPda: f.matchPda,
          marketSeq: soMarket.marketSeq,
          marketType: MarketType.PenaltyShootoutShot,
          settlementSeq: (event as any).seq ?? 0,
        });
      }
      this.openMarket(fixtureId, MarketType.PenaltyShootoutShot, state, actions);
      f.penaltyShootoutMarket++;
    }
  }

  private handleVar(
    event: VarCheckEvent,
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    this.openMarket(fixtureId, MarketType.VARCheck, state, actions, event);
  }

  private handleVarEnd(
    event: VarEndEvent,
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    const f = this.getOrCreateFixture(fixtureId);

    const current = this.findOpenMarket(f, MarketType.VARCheck);
    if (current) {
      const outcome = event.outcome === "Overturned" ? "Yes" : "No";
      current.status = "settling";
      current.settledAt = Date.now();
      actions.push({
        type: "resolve_market_offchain",
        fixtureId,
        matchPda: f.matchPda,
        marketSeq: current.marketSeq,
        marketType: MarketType.VARCheck,
        outcome,
      });
    }
  }

  private handleStatus(
    event: StatusChangeEvent,
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    const f = this.getOrCreateFixture(fixtureId);

    switch (event.statusId) {
      case StatusId.FirstHalf:
        this.openMarket(fixtureId, MarketType.NextGoalSide, state, actions);
        this.openMarket(fixtureId, MarketType.RedCardInMatch, state, actions);
        break;

      case StatusId.PenaltyShootout:
        f.penaltyShootoutMode = true;
        f.penaltyShootoutMarket = 0;
        this.openMarket(fixtureId, MarketType.PenaltyShootoutShot, state, actions);
        f.penaltyShootoutMarket++;
        break;

      case StatusId.FinishedAfterPenaltyShootout:
        this.cleanupPenaltyShootout(fixtureId, actions);
        this.matchEndCleanup(fixtureId, actions);
        break;

      case StatusId.FullTime:
      case StatusId.FinishedAfterExtraTime:
        this.matchEndCleanup(fixtureId, actions);
        break;
    }
  }

  private matchEndCleanup(fixtureId: number, actions: TriggerAction[]): void {
    const f = this.fixtures.get(fixtureId);
    if (!f) return;

    const onChainMarkets = new Set<MarketType>([
      MarketType.NextGoalSide,
      MarketType.NextCorner,
      MarketType.NextYellowCard,
      MarketType.GoalInWindow,
      MarketType.CornerInWindow,
      MarketType.YellowCardInWindow,
      MarketType.RedCardInMatch,
      MarketType.PenaltyShootoutShot,
    ]);

    const seq = this.lastSeenSeq.get(fixtureId) ?? 0;

    for (const [, market] of f.markets) {
      if (market.status !== "open") continue;
      market.status = "settling";
      market.settledAt = Date.now();

      if (onChainMarkets.has(market.marketType)) {
        actions.push({
          type: "resolve_market_onchain",
          fixtureId,
          matchPda: f.matchPda,
          marketSeq: market.marketSeq,
          marketType: market.marketType,
          settlementSeq: seq,
        });
      } else {
        actions.push({
          type: "resolve_market_offchain",
          fixtureId,
          matchPda: f.matchPda,
          marketSeq: market.marketSeq,
          marketType: market.marketType,
          outcome: "No",
        });
      }
    }
  }

  private cleanupPenaltyShootout(fixtureId: number, actions: TriggerAction[]): void {
    const f = this.fixtures.get(fixtureId);
    if (!f) return;

    const soMarket = this.findOpenMarket(f, MarketType.PenaltyShootoutShot);
    if (soMarket) {
      soMarket.status = "settling";
      soMarket.settledAt = Date.now();
      const seq = this.lastSeenSeq.get(fixtureId) ?? 0;
      actions.push({
        type: "resolve_market_onchain",
        fixtureId,
        matchPda: f.matchPda,
        marketSeq: soMarket.marketSeq,
        marketType: MarketType.PenaltyShootoutShot,
        settlementSeq: seq,
      });
    }

    f.penaltyShootoutMode = false;
    f.penaltyShootoutMarket = 0;
  }

  private checkCronWindows(
    fixtureId: number,
    state: MatchState,
    actions: TriggerAction[],
  ): void {
    const f = this.fixtures.get(fixtureId);
    if (!f || !f.cronWindowsEnabled) return;

    const matchTimeSec = Math.floor(state.matchClockMs / 1000);
    if (matchTimeSec <= 0) return;

    if (statusEndsMatch(state.status)) return;

    const windows: { marketType: MarketType; intervalSec: number }[] = [
      { marketType: MarketType.GoalInWindow, intervalSec: 300 },
      { marketType: MarketType.CornerInWindow, intervalSec: 180 },
      { marketType: MarketType.YellowCardInWindow, intervalSec: 300 },
    ];

    for (const w of windows) {
      const lastOpened = f.lastCronWindow.get(w.marketType) ?? 0;
      if (matchTimeSec - lastOpened >= w.intervalSec) {
        this.openMarket(fixtureId, w.marketType, state, actions);
        f.lastCronWindow.set(w.marketType, matchTimeSec);
      }
    }
  }

  public runCronCheck(fixtureId: number, state: MatchState): void {
    const actions: TriggerAction[] = [];
    this.checkCronWindows(fixtureId, state, actions);
    if (actions.length > 0) {
      this.emit("actions", actions);
    }
  }
}
