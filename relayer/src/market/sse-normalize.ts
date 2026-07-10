import type { ScoresSseData, SoccerData, SoccerFixtureScore } from "./event-parser";

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

export interface NormalizedSseData extends ScoresSseData {
  _extra?: Record<string, unknown>;
}

export function normalizeSsePayload(raw: Record<string, unknown>): NormalizedSseData {
  const extra: Record<string, unknown> = {};
  const knownKeys = new Set([
    "FixtureId", "fixtureId",
    "Action", "action",
    "Participant", "participant",
    "GameState", "gameState",
    "Id", "id",
    "Seq", "seq",
    "Ts", "ts",
    "Confirmed", "confirmed",
    "Clock", "clock",
    "Data", "dataSoccer",
    "Score", "Score",
    "scoreSoccer", "scoreSoccer",
  ]);

  for (const key of Object.keys(raw)) {
    if (!knownKeys.has(key)) {
      extra[key] = raw[key];
    }
  }

  return {
    fixtureId: num(raw.FixtureId ?? raw.fixtureId) ?? 0,
    action: str(raw.Action ?? raw.action) ?? "",
    participant: num(raw.Participant ?? raw.participant) as 1 | 2 | undefined,
    gameState: str(raw.GameState ?? raw.gameState) ?? "",
    id: num(raw.Id ?? raw.id) ?? 0,
    seq: num(raw.Seq ?? raw.seq) ?? 0,
    ts: num(raw.Ts ?? raw.ts) ?? 0,
    confirmed: (raw.Confirmed ?? raw.confirmed) as boolean | undefined,
    clock: (raw.Clock ?? raw.clock) as { running: boolean; seconds: number } | undefined,
    dataSoccer: (raw.Data ?? raw.dataSoccer) as SoccerData | undefined,
    scoreSoccer: (raw.Score ?? raw.scoreSoccer) as SoccerFixtureScore | undefined,
    _extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}
