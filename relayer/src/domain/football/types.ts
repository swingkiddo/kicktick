import type { PublicKey } from "@solana/web3.js";
import type { FixtureId, TxLineSequence } from "../ids";

export enum SoccerAction {
  Goal = "goal",
  Corner = "corner",
  YellowCard = "yellow_card",
  RedCard = "red_card",
  Penalty = "penalty",
  PenaltyOutcome = "penalty_outcome",
  Shot = "shot",
  FreeKick = "free_kick",
  ThrowIn = "throw_in",
  GoalKick = "goal_kick",
  Var = "var",
  VarEnd = "var_end",
  Possible = "possible",
  Status = "status",
  ScoreAdjustment = "score_adjustment",
  AdditionalTime = "additional_time",
  Kickoff = "kickoff",
  Substitution = "substitution",
  Injury = "injury",
  Suspend = "suspend",
}

export enum StatusId {
  NotStarted = 1,
  FirstHalf = 2,
  HalfTime = 3,
  SecondHalf = 4,
  FullTime = 5,
  WaitingExtraTime = 6,
  ExtraTimeFirstHalf = 7,
  ExtraTimeHalfTime = 8,
  ExtraTimeSecondHalf = 9,
  FinishedAfterExtraTime = 10,
  WaitingPenaltyShootout = 11,
  PenaltyShootout = 12,
  FinishedAfterPenaltyShootout = 13,
  Interrupted = 14,
  Abandoned = 15,
  Cancelled = 16,
}

export enum GoalType { Shot = "Shot", Head = "Head", Own = "Own", Other = "Other" }
export enum VarType { Goal = "Goal", Penalty = "Penalty", RedCard = "RedCard", SecondYellowCard = "SecondYellowCard", CornerKick = "CornerKick", Other = "Other" }

export interface SoccerScorePeriod { Goals: number; YellowCards: number; RedCards: number; Corners: number; }
export interface SoccerTotalScore {
  Total?: SoccerScorePeriod; H1?: SoccerScorePeriod; H2?: SoccerScorePeriod; HT?: SoccerScorePeriod;
  ET1?: SoccerScorePeriod; ET2?: SoccerScorePeriod; PE?: SoccerScorePeriod; ETTotal?: SoccerScorePeriod;
}
export interface SoccerFixtureScore { Participant1: SoccerTotalScore; Participant2: SoccerTotalScore; }
export interface SoccerData {
  Participant?: number; PlayerId?: number; GoalType?: string; Outcome?: string; FreeKickType?: string;
  ThrowInType?: string; Type?: string; StatusId?: number; Minutes?: number; PlayerInId?: number;
  PlayerOutId?: number; Goal?: boolean; Corner?: boolean; Penalty?: boolean; RedCard?: boolean;
  YellowCard?: boolean; VAR?: boolean;
}
export interface ScoresSseData {
  fixtureId: FixtureId; action: string; participant?: number; gameState: string; id: number;
  seq: TxLineSequence; ts: number; confirmed?: boolean; clock?: { running: boolean; seconds: number };
  dataSoccer?: SoccerData; scoreSoccer?: SoccerFixtureScore;
}

export type {
  FootballEvent,
  SoccerEvent,
  GoalEvent,
  CornerEvent,
  YellowCardEvent,
  RedCardEvent,
  PenaltyAwardedEvent,
  PenaltyOutcomeEvent,
  ShotEvent,
  FreeKickEvent,
  ThrowInEvent,
  GoalKickEvent,
  VarCheckEvent,
  VarEndEvent,
  PossibleEvent,
  StatusChangeEvent,
  ScoreAdjustmentEvent,
  AdditionalTimeEvent,
  KickoffEvent,
  SubstitutionEvent,
  InjuryEvent,
  SuspendEvent,
} from "./events";

export interface MatchState {
  fixtureId: FixtureId;
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
