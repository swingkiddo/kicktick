import type { FixtureId, TxLineSequence, UnixMilliseconds } from "../ids";
import { GoalType, SoccerAction, StatusId, VarType } from "./types";

export interface FootballEventMetadata {
  fixtureId: FixtureId;
  txLineSequence: TxLineSequence;
  occurredAt: UnixMilliseconds;
  gameState: string;
  sourceMessageId: string;
}

interface EventBase {
  metadata: FootballEventMetadata;
  participant?: 1 | 2;
}

export interface GoalEvent extends EventBase { action: SoccerAction.Goal; goalType: GoalType; playerId?: number; }
export interface CornerEvent extends EventBase { action: SoccerAction.Corner; }
export interface YellowCardEvent extends EventBase { action: SoccerAction.YellowCard; playerId?: number; }
export interface RedCardEvent extends EventBase { action: SoccerAction.RedCard; playerId?: number; redCardType: "StraightRed" | "SecondYellow"; }
export interface PenaltyAwardedEvent extends EventBase { action: SoccerAction.Penalty; }
export interface PenaltyOutcomeEvent extends EventBase { action: SoccerAction.PenaltyOutcome; outcome: "Scored" | "Missed" | "Retake"; followsAction?: unknown; }
export interface ShotEvent extends EventBase { action: SoccerAction.Shot; outcome: "OnTarget" | "OffTarget" | "Woodwork" | "Blocked"; }
export interface FreeKickEvent extends EventBase { action: SoccerAction.FreeKick; freeKickType?: string; }
export interface ThrowInEvent extends EventBase { action: SoccerAction.ThrowIn; throwInType?: string; }
export interface GoalKickEvent extends EventBase { action: SoccerAction.GoalKick; }
export interface VarCheckEvent extends EventBase { action: SoccerAction.Var; varType: VarType; }
export interface VarEndEvent extends EventBase { action: SoccerAction.VarEnd; outcome: "Stands" | "Overturned"; }
export interface PossibleEvent extends EventBase {
  action: SoccerAction.Possible;
  possibleGoal?: boolean;
  possiblePenalty?: boolean;
  possibleCorner?: boolean;
  possibleYellowCard?: boolean;
  possibleRedCard?: boolean;
  possibleVar?: boolean;
}
export interface StatusChangeEvent extends EventBase { action: SoccerAction.Status; statusId: StatusId; }
export interface ScoreAdjustmentEvent extends EventBase { action: SoccerAction.ScoreAdjustment; score: Record<string, unknown>; }
export interface AdditionalTimeEvent extends EventBase { action: SoccerAction.AdditionalTime; minutes: number; }
export interface KickoffEvent extends EventBase { action: SoccerAction.Kickoff; }
export interface SubstitutionEvent extends EventBase { action: SoccerAction.Substitution; playerInId: number; playerOutId: number; }
export interface InjuryEvent extends EventBase { action: SoccerAction.Injury; playerId?: number; outcome?: "OnPitch" | "OffPitch" | "NotReturning"; }
export interface SuspendEvent extends EventBase { action: SoccerAction.Suspend; reliable: boolean; }

export type FootballEvent =
  | GoalEvent | CornerEvent | YellowCardEvent | RedCardEvent | PenaltyAwardedEvent | PenaltyOutcomeEvent
  | ShotEvent | FreeKickEvent | ThrowInEvent | GoalKickEvent | VarCheckEvent | VarEndEvent | PossibleEvent
  | StatusChangeEvent | ScoreAdjustmentEvent | AdditionalTimeEvent | KickoffEvent | SubstitutionEvent
  | InjuryEvent | SuspendEvent;

export type SoccerEvent = FootballEvent;

export interface NormalizedScoreUpdate {
  fixtureId: FixtureId;
  action: string;
  participant?: 1 | 2;
  gameState: string;
  id: number;
  seq: TxLineSequence;
  ts: number;
  sourceMessageId: string;
  confirmed?: boolean;
  dataSoccer?: {
    Participant?: number;
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
  };
  scoreSoccer?: Record<string, unknown>;
}
