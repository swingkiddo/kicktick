import type { FixtureId, MarketSequence, StatKey, StatPeriod, TxLineSequence, UnixSeconds } from "./ids";

export enum MarketType {
  NextGoalSide = "NextGoalSide",
  GoalInWindow = "GoalInWindow",
  NextCorner = "NextCorner",
  CornerInWindow = "CornerInWindow",
  NextYellowCard = "NextYellowCard",
  YellowCardInWindow = "YellowCardInWindow",
  RedCardInMatch = "RedCardInMatch",
  PenaltyShootoutShot = "PenaltyShootoutShot",
  PenaltyShot = "PenaltyShot",
  VARCheck = "VARCheck",
}

export type MarketOutcome = "None" | "Yes" | "No" | "NoGoal" | "Home" | "Away" | "Cancelled";
export type ResolvedMarketOutcome = Exclude<MarketOutcome, "None">;
export type MarketState = "OPEN" | "LOCKED" | "RESOLVED_PENDING" | "RESOLVED" | "VOIDED";

export interface MarketOpenParams {
  participant: number;
  period: StatPeriod;
  baselineA: number;
  baselineB: number;
}

interface MarketCommandBase {
  fixtureId: FixtureId;
  matchPda: string;
  marketSeq: MarketSequence;
  marketType: MarketType;
}

export type MarketCommand =
  | (MarketCommandBase & {
      type: "open_market";
      lockSeconds: number;
      deadlineSeconds: number;
      params?: MarketOpenParams;
      triggerSseSeq?: TxLineSequence;
    })
  | (MarketCommandBase & {
      type: "resolve_market_onchain";
      settlementSeq: TxLineSequence;
      targetStatKey?: StatKey;
    })
  | (MarketCommandBase & {
      type: "resolve_market_offchain";
      outcome: ResolvedMarketOutcome;
    })
  | (MarketCommandBase & { type: "confirm_market" });

/** Durable market entity returned by the current persistence boundary. */
export interface MarketRecord {
  market: string;
  fixture_id: string;
  market_type: string;
  market_seq: string;
  outcome_count: number;
  expires_at: UnixSeconds;
  state: MarketState;
  chain_fill_sequence: bigint;
  created_at: number;
  updated_at: number;
}
