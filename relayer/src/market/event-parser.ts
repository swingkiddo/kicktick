import { TxLineSseEvent } from "../clients/txline-client";

// ── Enums ──

export enum FootballAction {
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

export enum GoalType {
  Shot = "Shot",
  Head = "Head",
  Own = "Own",
  Other = "Other",
}

export enum VarType {
  Goal = "Goal",
  Penalty = "Penalty",
  RedCard = "RedCard",
  SecondYellowCard = "SecondYellowCard",
  CornerKick = "CornerKick",
  Other = "Other",
}

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

// ── Raw SSE data shape ──

export interface RawSseData {
  Action?: string;
  Participant?: number;
  PlayerId?: number;
  GoalType?: string;
  Data?: Record<string, unknown>;
  Score?: Record<string, unknown>;
  FollowsAction?: unknown;
  PlayerInId?: number;
  PlayerOutId?: number;
}

// ── Typed event interfaces ──

export interface GoalEvent {
  action: FootballAction.Goal;
  participant?: 1 | 2;
  goalType: GoalType;
  playerId?: number;
}

export interface CornerEvent {
  action: FootballAction.Corner;
  participant?: 1 | 2;
}

export interface YellowCardEvent {
  action: FootballAction.YellowCard;
  participant?: 1 | 2;
  playerId?: number;
}

export interface RedCardEvent {
  action: FootballAction.RedCard;
  participant?: 1 | 2;
  playerId?: number;
  redCardType: "StraightRed" | "SecondYellow";
}

export interface PenaltyAwardedEvent {
  action: FootballAction.Penalty;
  participant?: 1 | 2;
}

export interface PenaltyOutcomeEvent {
  action: FootballAction.PenaltyOutcome;
  participant?: 1 | 2;
  outcome: "Scored" | "Missed" | "Retake";
  followsAction?: unknown;
}

export interface ShotEvent {
  action: FootballAction.Shot;
  participant?: 1 | 2;
  outcome: "OnTarget" | "OffTarget" | "Woodwork" | "Blocked";
}

export interface FreeKickEvent {
  action: FootballAction.FreeKick;
  participant?: 1 | 2;
  freeKickType?: string;
}

export interface ThrowInEvent {
  action: FootballAction.ThrowIn;
  participant?: 1 | 2;
  throwInType?: string;
}

export interface GoalKickEvent {
  action: FootballAction.GoalKick;
  participant?: 1 | 2;
}

export interface VarCheckEvent {
  action: FootballAction.Var;
  participant?: 1 | 2;
  varType: VarType;
}

export interface VarEndEvent {
  action: FootballAction.VarEnd;
  participant?: 1 | 2;
  outcome: "Stands" | "Overturned";
}

export interface PossibleEvent {
  action: FootballAction.Possible;
  participant?: 1 | 2;
  possibleGoal?: boolean;
  possiblePenalty?: boolean;
  possibleCorner?: boolean;
  possibleYellowCard?: boolean;
  possibleRedCard?: boolean;
  possibleVar?: boolean;
}

export interface StatusChangeEvent {
  action: FootballAction.Status;
  participant?: 1 | 2;
  statusId: StatusId;
}

export interface ScoreAdjustmentEvent {
  action: FootballAction.ScoreAdjustment;
  participant?: 1 | 2;
  score: Record<string, unknown>;
}

export interface AdditionalTimeEvent {
  action: FootballAction.AdditionalTime;
  participant?: 1 | 2;
  minutes: number;
}

export interface KickoffEvent {
  action: FootballAction.Kickoff;
  participant?: 1 | 2;
}

export interface SubstitutionEvent {
  action: FootballAction.Substitution;
  participant?: 1 | 2;
  playerInId: number;
  playerOutId: number;
}

export interface InjuryEvent {
  action: FootballAction.Injury;
  participant?: 1 | 2;
  playerId?: number;
  outcome?: "OnPitch" | "OffPitch" | "NotReturning";
}

export interface SuspendEvent {
  action: FootballAction.Suspend;
  participant?: 1 | 2;
  reliable: boolean;
}

// ── Union type ──

export type FootballEvent =
  | GoalEvent
  | CornerEvent
  | YellowCardEvent
  | RedCardEvent
  | PenaltyAwardedEvent
  | PenaltyOutcomeEvent
  | ShotEvent
  | FreeKickEvent
  | ThrowInEvent
  | GoalKickEvent
  | VarCheckEvent
  | VarEndEvent
  | PossibleEvent
  | StatusChangeEvent
  | ScoreAdjustmentEvent
  | AdditionalTimeEvent
  | KickoffEvent
  | SubstitutionEvent
  | InjuryEvent
  | SuspendEvent;

// ── Type guard ──

export function isStatusId(value: number): value is StatusId {
  return Number.isInteger(value) && value >= 1 && value <= 16;
}

// ── Parser ──

export function parseFootballEvent(event: TxLineSseEvent): FootballEvent {
  let raw: RawSseData;
  try {
    raw = JSON.parse(event.data);
  } catch {
    throw new Error(`Invalid JSON in SSE data: ${event.data}`);
  }

  const action = raw.Action;
  const participant = parseParticipant(raw.Participant);

  if (!action) {
    throw new Error("Missing Action field in SSE data");
  }

  switch (action) {
    case FootballAction.Goal:
      return {
        action: FootballAction.Goal,
        participant,
        goalType: parseGoalType(raw.GoalType),
        playerId: raw.PlayerId,
      };

    case FootballAction.Corner:
      return {
        action: FootballAction.Corner,
        participant,
      };

    case FootballAction.YellowCard:
      return {
        action: FootballAction.YellowCard,
        participant,
        playerId: raw.PlayerId,
      };

    case FootballAction.RedCard:
      return {
        action: FootballAction.RedCard,
        participant,
        playerId: raw.PlayerId,
        redCardType: parseRedCardType(raw.Data?.Type),
      };

    case FootballAction.Penalty:
      return {
        action: FootballAction.Penalty,
        participant,
      };

    case FootballAction.PenaltyOutcome:
      return {
        action: FootballAction.PenaltyOutcome,
        participant,
        outcome: parsePenaltyOutcome(raw.Data?.Outcome),
        followsAction: raw.FollowsAction,
      };

    case FootballAction.Shot:
      return {
        action: FootballAction.Shot,
        participant,
        outcome: parseShotOutcome(raw.Data?.Outcome),
      };

    case FootballAction.FreeKick:
      return {
        action: FootballAction.FreeKick,
        participant,
        freeKickType: extractOptionalString(raw.Data?.FreeKickType),
      };

    case FootballAction.ThrowIn:
      return {
        action: FootballAction.ThrowIn,
        participant,
        throwInType: extractOptionalString(raw.Data?.ThrowInType),
      };

    case FootballAction.GoalKick:
      return {
        action: FootballAction.GoalKick,
        participant,
      };

    case FootballAction.Var:
      return {
        action: FootballAction.Var,
        participant,
        varType: parseVarType(raw.Data?.Type),
      };

    case FootballAction.VarEnd:
      return {
        action: FootballAction.VarEnd,
        participant,
        outcome: parseVarEndOutcome(raw.Data?.Outcome),
      };

    case FootballAction.Possible: {
      const d = raw.Data || {};
      return {
        action: FootballAction.Possible,
        participant,
        possibleGoal: extractOptionalBool(d.Goal),
        possiblePenalty: extractOptionalBool(d.Penalty),
        possibleCorner: extractOptionalBool(d.Corner),
        possibleYellowCard: extractOptionalBool(d.YellowCard),
        possibleRedCard: extractOptionalBool(d.RedCard),
        possibleVar: extractOptionalBool(d.VAR),
      };
    }

    case FootballAction.Status: {
      const statusId = raw.Data?.StatusId;
      if (typeof statusId !== "number" || !isStatusId(statusId)) {
        throw new Error(`Invalid or missing StatusId: ${statusId}`);
      }
      return {
        action: FootballAction.Status,
        participant,
        statusId,
      };
    }

    case FootballAction.ScoreAdjustment:
      return {
        action: FootballAction.ScoreAdjustment,
        participant,
        score: (raw.Score as Record<string, unknown>) || {},
      };

    case FootballAction.AdditionalTime:
      return {
        action: FootballAction.AdditionalTime,
        participant,
        minutes: extractNumber(raw.Data?.Minutes, 0),
      };

    case FootballAction.Kickoff:
      return {
        action: FootballAction.Kickoff,
        participant,
      };

    case FootballAction.Substitution:
      return {
        action: FootballAction.Substitution,
        participant,
        playerInId: extractNumber(raw.PlayerInId, 0),
        playerOutId: extractNumber(raw.PlayerOutId, 0),
      };

    case FootballAction.Injury:
      return {
        action: FootballAction.Injury,
        participant,
        playerId: raw.PlayerId,
        outcome: parseInjuryOutcome(raw.Data?.Outcome),
      };

    case FootballAction.Suspend:
      return {
        action: FootballAction.Suspend,
        participant,
        reliable: extractBool(raw.Data?.Reliable, false),
      };

    default:
      throw new Error(`Unknown football action: ${action}`);
  }
}

// ── Extraction helpers ──

function extractString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function extractOptionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function extractNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function extractBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function extractOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

// ── Safer typed-value helpers ──

function parseParticipant(val: unknown): 1 | 2 | undefined {
  if (val === 1) return 1;
  if (val === 2) return 2;
  return undefined;
}

function parseGoalType(val: unknown): GoalType {
  if (typeof val === 'string' && Object.values(GoalType).includes(val as GoalType)) {
    return val as GoalType;
  }
  return GoalType.Shot;
}

function parseVarType(val: unknown): VarType {
  if (typeof val === 'string' && Object.values(VarType).includes(val as VarType)) {
    return val as VarType;
  }
  return VarType.Goal;
}

function parseRedCardType(val: unknown): "StraightRed" | "SecondYellow" {
  if (val === "StraightRed") return "StraightRed";
  if (val === "SecondYellow") return "SecondYellow";
  return "StraightRed";
}

function parsePenaltyOutcome(val: unknown): "Scored" | "Missed" | "Retake" {
  if (val === "Scored") return "Scored";
  if (val === "Missed") return "Missed";
  if (val === "Retake") return "Retake";
  return "Scored";
}

function parseShotOutcome(val: unknown): "OnTarget" | "OffTarget" | "Woodwork" | "Blocked" {
  if (val === "OnTarget") return "OnTarget";
  if (val === "OffTarget") return "OffTarget";
  if (val === "Woodwork") return "Woodwork";
  if (val === "Blocked") return "Blocked";
  return "OnTarget";
}

function parseVarEndOutcome(val: unknown): "Stands" | "Overturned" {
  if (val === "Stands") return "Stands";
  if (val === "Overturned") return "Overturned";
  return "Stands";
}

function parseInjuryOutcome(val: unknown): "OnPitch" | "OffPitch" | "NotReturning" | undefined {
  if (val === "OnPitch") return "OnPitch";
  if (val === "OffPitch") return "OffPitch";
  if (val === "NotReturning") return "NotReturning";
  return undefined;
}

// ── Market type mapping ──

export function getTriggeredMarketTypes(event: FootballEvent): MarketType[] {
  switch (event.action) {
    case FootballAction.Goal:
      return [MarketType.NextGoalSide];

    case FootballAction.Corner:
      return [MarketType.NextCorner];

    case FootballAction.YellowCard:
      return [MarketType.NextYellowCard];

    case FootballAction.RedCard:
      return [MarketType.RedCardInMatch];

    case FootballAction.Penalty:
      return [MarketType.PenaltyShot];

    case FootballAction.PenaltyOutcome:
      return [MarketType.PenaltyShot, MarketType.PenaltyShootoutShot];

    case FootballAction.Var:
      return [MarketType.VARCheck];

    case FootballAction.VarEnd:
      return [MarketType.VARCheck];

    case FootballAction.Status: {
      const { statusId } = event;
      if (
        statusId === StatusId.FullTime ||
        statusId === StatusId.FinishedAfterExtraTime ||
        statusId === StatusId.FinishedAfterPenaltyShootout
      ) {
        return [MarketType.RedCardInMatch];
      }
      if (statusId === StatusId.PenaltyShootout) {
        return [MarketType.PenaltyShootoutShot];
      }
      return [];
    }

    default:
      return [];
  }
}
