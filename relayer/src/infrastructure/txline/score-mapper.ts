import type { ScoresRecord } from "@swingkiddo/txodds-client";
import type { ScoresSseData, SoccerData, SoccerFixtureScore } from "../../domain/football/types";

export interface RawClock {
  Running?: boolean;
  running?: boolean;
  Seconds?: number;
  seconds?: number;
}

export interface RawPeriodScore {
  Goals?: number;
  YellowCards?: number;
  RedCards?: number;
  Corners?: number;
}

export interface RawParticipantScore {
  H1?: RawPeriodScore;
  H2?: RawPeriodScore;
  HT?: RawPeriodScore;
  ET1?: RawPeriodScore;
  ET2?: RawPeriodScore;
  PE?: RawPeriodScore;
  ETTotal?: RawPeriodScore;
  Total?: RawPeriodScore;
  h1?: RawPeriodScore;
  h2?: RawPeriodScore;
  ht?: RawPeriodScore;
  total?: RawPeriodScore;
}

export interface RawScore {
  Participant1?: RawParticipantScore;
  Participant2?: RawParticipantScore;
  participant1?: RawParticipantScore;
  participant2?: RawParticipantScore;
}

export interface RawEventData {
  Participant?: 1 | 2;
  PlayerId?: number;
  GoalType?: string;
  Outcome?: string;
  FreeKickType?: string;
  ThrowInType?: string;
  Type?: string;
  StatusId?: number;
  Minutes?: number;
  PlayerInId?: number;
  PlayerOutId?: number;
  Goal?: boolean;
  Corner?: boolean;
  Penalty?: boolean;
  RedCard?: boolean;
  YellowCard?: boolean;
  VAR?: boolean;
}

/** Typed raw JSON carried by SseMessage.data and score replay responses. */
export interface RawScoreEventPayload {
  FixtureId?: number;
  GameState?: string | number;
  StartTime?: number;
  IsTeam?: boolean;
  FixtureGroupId?: number;
  CountryId?: number;
  Participant1IsHome?: boolean;
  Participant1Id?: number;
  Participant2Id?: number;
  CompetitionId?: number;
  SportId?: number;
  CoverageSecondaryData?: boolean;
  CoverageType?: string;
  Action?: string;
  Type?: string;
  Participant?: 1 | 2;
  Possession?: number;
  PossessionType?: string;
  StatusId?: number;
  Id?: number;
  Seq?: number;
  Ts?: number;
  ConnectionId?: number;
  Confirmed?: boolean;
  Clock?: RawClock;
  Data?: RawEventData;
  Stats?: Record<string, number>;
  Score?: RawScore;
}

/** Compatibility shape for SDK/runtime responses that are already camelCase. */
export interface RawScoreCompatibilityPayload {
  fixtureId?: number;
  gameState?: string | number;
  participant1IsHome?: boolean;
  action?: string;
  type?: string;
  participant?: 1 | 2;
  statusId?: number;
  id?: number;
  seq?: number;
  ts?: number;
  confirmed?: boolean;
  clock?: RawClock;
  data?: RawEventData;
  dataSoccer?: RawEventData;
  stats?: Record<string, number>;
  score?: RawScore;
  scoreSoccer?: RawScore;
  homeScore?: number;
  HomeScore?: number;
  awayScore?: number;
  AwayScore?: number;
}

export type RawScoreInput = RawScoreEventPayload | RawScoreCompatibilityPayload;

export interface NormalizedSseData extends ScoresSseData {
  participant1IsHome?: boolean;
  statusId?: number;
  type?: string;
  stats?: Record<number, number>;
  metadata?: Record<string, unknown>;
  sourceMessageId: string;
}

type RawObject = Record<string, unknown>;

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const ACTION_ALIASES: Record<string, string> = {
  goal: "goal",
  corner: "corner",
  yellowcard: "yellow_card",
  redcard: "red_card",
  penalty: "penalty",
  penaltyawarded: "penalty",
  penaltyoutcome: "penalty_outcome",
  shot: "shot",
  freekick: "free_kick",
  throwin: "throw_in",
  goalkick: "goal_kick",
  var: "var",
  varcheck: "var",
  varend: "var_end",
  possible: "possible",
  status: "status",
  score: "score_adjustment",
  scoreadjustment: "score_adjustment",
  additionaltime: "additional_time",
  kickoff: "kickoff",
  substitution: "substitution",
  injury: "injury",
  suspend: "suspend",
};

function normalizeAction(value: unknown): string {
  const action = stringValue(value);
  if (!action) return "";
  const key = action.replace(/[\s_-]/g, "").toLowerCase();
  return ACTION_ALIASES[key] ?? action;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function objectValue(value: unknown): RawObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RawObject
    : undefined;
}

function normalizeClock(value: RawClock | undefined): { running: boolean; seconds: number } | undefined {
  const clock = objectValue(value);
  if (!clock) return undefined;

  const running = booleanValue(clock.Running ?? clock.running);
  const seconds = numberValue(clock.Seconds ?? clock.seconds);
  if (running === undefined && seconds === undefined) return undefined;

  return {
    running: running ?? false,
    seconds: seconds ?? 0,
  };
}

function normalizeStats(value: Record<string, number> | undefined): Record<number, number> {
  const stats = objectValue(value);
  if (!stats) return {};

  const normalized: Record<number, number> = {};
  for (const [key, rawValue] of Object.entries(stats)) {
    const statKey = numberValue(key);
    const statValue = numberValue(rawValue);
    if (statKey !== undefined && statValue !== undefined) normalized[statKey] = statValue;
  }
  return normalized;
}

function participantGoals(score: RawScore | undefined, participant: "Participant1" | "Participant2"): number | undefined {
  if (!score) return undefined;
  const scoreObject = score as unknown as RawObject;
  if (!scoreObject) return undefined;

  const pascal = objectValue(scoreObject[participant]);
  const camel = objectValue(scoreObject[participant.toLowerCase()]);
  const total = objectValue(pascal?.Total ?? pascal?.total ?? camel?.Total ?? camel?.total);
  return numberValue(total?.Goals ?? total?.goals);
}

function normalizedScore(
  raw: RawScoreInput,
): { homeScore: number; awayScore: number } {
  const input = raw as RawObject;
  const explicitHome = numberValue(input.homeScore ?? input.HomeScore);
  const explicitAway = numberValue(input.awayScore ?? input.AwayScore);
  if (explicitHome !== undefined || explicitAway !== undefined) {
    return { homeScore: explicitHome ?? 0, awayScore: explicitAway ?? 0 };
  }

  const rawScore = input.Score ?? input.score ?? input.scoreSoccer;
  const participant1 = participantGoals(rawScore, "Participant1") ?? 0;
  const participant2 = participantGoals(rawScore, "Participant2") ?? 0;
  const participant1IsHome = booleanValue(input.Participant1IsHome ?? input.participant1IsHome);

  if (rawScore !== undefined && participant1IsHome === undefined) {
    throw new Error("TxLINE score payload is missing Participant1IsHome");
  }

  return participant1IsHome === false
    ? { homeScore: participant2, awayScore: participant1 }
    : { homeScore: participant1, awayScore: participant2 };
}

const knownKeys = new Set([
  "FixtureId", "fixtureId", "GameState", "gameState", "StartTime", "IsTeam", "FixtureGroupId",
  "CountryId", "CompetitionId", "SportId", "Participant1Id", "Participant2Id",
  "Participant1IsHome", "participant1IsHome", "CoverageSecondaryData", "CoverageType",
  "Action", "action", "Type", "type", "Participant", "participant",
  "StatusId", "statusId", "Id", "id", "Seq", "seq", "Ts", "ts",
  "Confirmed", "confirmed", "Clock", "clock", "Data", "data", "dataSoccer", "Stats", "stats",
  "Score", "score", "scoreSoccer", "homeScore", "HomeScore", "awayScore", "AwayScore",
]);

export function parseRawScoreEventPayload(value: unknown): RawScoreInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("TxLINE score payload must be a JSON object");
  }

  const raw = value as RawObject;
  const fixtureId = raw.FixtureId ?? raw.fixtureId;
  const seq = raw.Seq ?? raw.seq;
  if (fixtureId !== undefined && numberValue(fixtureId) === undefined) {
    throw new Error("TxLINE score payload has an invalid FixtureId");
  }
  if (seq !== undefined && numberValue(seq) === undefined) {
    throw new Error("TxLINE score payload has an invalid Seq");
  }

  return raw as RawScoreInput;
}

export function normalizeScoreEvent(
  raw: RawScoreInput,
  options: { includeMetadata?: boolean; sourceMessageId?: string } = {},
): NormalizedSseData {
  const metadata: Record<string, unknown> = {};
  if (options.includeMetadata) {
    for (const [key, value] of Object.entries(raw)) {
      if (!knownKeys.has(key)) metadata[key] = value;
    }
  }

  const input = raw as RawObject;
  const normalized = normalizedScore(raw);
  const fixtureId = numberValue(input.FixtureId ?? input.fixtureId) ?? 0;
  const id = numberValue(input.Id ?? input.id) ?? 0;
  const seq = numberValue(input.Seq ?? input.seq) ?? 0;
  const statusId = numberValue(input.StatusId ?? input.statusId);
  const stats = normalizeStats(input.Stats ?? input.stats);

  return {
    fixtureId,
    action: normalizeAction(input.Action ?? input.action),
    participant: numberValue(input.Participant ?? input.participant) as 1 | 2 | undefined,
    participant1IsHome: booleanValue(input.Participant1IsHome ?? input.participant1IsHome),
    gameState: stringValue(input.GameState ?? input.gameState) ?? (statusId === undefined ? "" : String(statusId)),
    id,
    seq,
    ts: numberValue(input.Ts ?? input.ts) ?? 0,
    sourceMessageId: options.sourceMessageId ?? `txline:${fixtureId}:${id}`,
    confirmed: booleanValue(input.Confirmed ?? input.confirmed),
    clock: normalizeClock(input.Clock ?? input.clock),
    statusId,
    type: stringValue(input.Type ?? input.type),
    stats,
    dataSoccer: objectValue(input.Data ?? input.data ?? input.dataSoccer) as SoccerData | undefined,
    scoreSoccer: objectValue(input.Score ?? input.score ?? input.scoreSoccer) as SoccerFixtureScore | undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    ...normalized,
  };
}

export function normalizeScoresRecord(raw: RawScoreInput): ScoresRecord {
  const normalized = normalizeScoreEvent(raw);
  const input = raw as RawObject;
  const gameState = numberValue(input.StatusId ?? input.statusId ?? input.gameState ?? input.GameState)
    ?? normalized.gameState;
  return {
    // Seq is the only source of the replay/proof cursor. Id is deliberately
    // not used as a fallback because it identifies an upstream event, not a
    // score update sequence.
    seq: normalized.seq,
    ts: normalized.ts,
    gameState: gameState as unknown as ScoresRecord["gameState"],
    homeScore: normalized.homeScore,
    awayScore: normalized.awayScore,
    stats: normalized.stats ?? {},
    fixtureId: normalized.fixtureId,
  };
}

export function parseScoresUpdatesBody(body: string): ScoresRecord[] {
  const trimmed = body.trim();
  if (!trimmed) return [];

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("Expected scores updates JSON array");
    return parsed.map((record) => normalizeScoresRecord(parseRawScoreEventPayload(record)));
  } catch (jsonError) {
    const records: ScoresRecord[] = [];
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;

      const parsed: unknown = JSON.parse(payload);
      if (Array.isArray(parsed)) {
        records.push(...parsed.map((record) => normalizeScoresRecord(parseRawScoreEventPayload(record))));
      } else {
        records.push(normalizeScoresRecord(parseRawScoreEventPayload(parsed)));
      }
    }
    if (records.length > 0) return records;
    throw jsonError;
  }
}
