import type { NormalizedSseData } from "../../infrastructure/txline/score-mapper";
import { GoalType, SoccerAction, StatusId, VarType } from "./types";
import type { FootballEvent, FootballEventMetadata } from "./events";

export type EventParseResult =
  | { kind: "event"; event: FootballEvent }
  | { kind: "unsupported"; action: string; metadata: FootballEventMetadata };

export function gameStateToStatusId(gameState: string): StatusId | undefined {
  const map: Record<string, StatusId> = {
    NS: StatusId.NotStarted, H1: StatusId.FirstHalf, HT: StatusId.HalfTime,
    H2: StatusId.SecondHalf, F: StatusId.FullTime, WET: StatusId.WaitingExtraTime,
    ET1: StatusId.ExtraTimeFirstHalf, HTET: StatusId.ExtraTimeHalfTime,
    ET2: StatusId.ExtraTimeSecondHalf, FET: StatusId.FinishedAfterExtraTime,
    WPE: StatusId.WaitingPenaltyShootout, PE: StatusId.PenaltyShootout,
    FPE: StatusId.FinishedAfterPenaltyShootout, I: StatusId.Interrupted,
    A: StatusId.Abandoned, C: StatusId.Cancelled,
  };
  return map[gameState];
}

export class MalformedScoreUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedScoreUpdateError";
  }
}

export function parseFootballEvent(update: NormalizedSseData): EventParseResult {
  if (!update.action) throw new MalformedScoreUpdateError("Missing action in normalized score update");
  if (!Number.isSafeInteger(update.fixtureId) || !Number.isSafeInteger(update.seq)) {
    throw new MalformedScoreUpdateError("Normalized score update has invalid identifiers");
  }

  const metadata: FootballEventMetadata = {
    fixtureId: update.fixtureId,
    txLineSequence: update.seq,
    occurredAt: update.ts * 1000,
    gameState: update.gameState,
    sourceMessageId: update.sourceMessageId,
  };
  const participant = parseParticipant(update.participant ?? update.dataSoccer?.Participant);
  const data = update.dataSoccer;
  const base = { metadata, participant };

  switch (update.action) {
    case SoccerAction.Goal: return { kind: "event", event: { ...base, action: SoccerAction.Goal, goalType: parseGoalType(data?.GoalType), playerId: data?.PlayerId } };
    case SoccerAction.Corner: return { kind: "event", event: { ...base, action: SoccerAction.Corner } };
    case SoccerAction.YellowCard: return { kind: "event", event: { ...base, action: SoccerAction.YellowCard, playerId: data?.PlayerId } };
    case SoccerAction.RedCard: return { kind: "event", event: { ...base, action: SoccerAction.RedCard, playerId: data?.PlayerId, redCardType: parseRedCardType(data?.Type) } };
    case SoccerAction.Penalty: return { kind: "event", event: { ...base, action: SoccerAction.Penalty } };
    case SoccerAction.PenaltyOutcome: return { kind: "event", event: { ...base, action: SoccerAction.PenaltyOutcome, outcome: parsePenaltyOutcome(data?.Outcome) } };
    case SoccerAction.Shot: return { kind: "event", event: { ...base, action: SoccerAction.Shot, outcome: parseShotOutcome(data?.Outcome) } };
    case SoccerAction.FreeKick: return { kind: "event", event: { ...base, action: SoccerAction.FreeKick, freeKickType: data?.FreeKickType } };
    case SoccerAction.ThrowIn: return { kind: "event", event: { ...base, action: SoccerAction.ThrowIn, throwInType: data?.ThrowInType } };
    case SoccerAction.GoalKick: return { kind: "event", event: { ...base, action: SoccerAction.GoalKick } };
    case SoccerAction.Var: return { kind: "event", event: { ...base, action: SoccerAction.Var, varType: parseVarType(data?.Type) } };
    case SoccerAction.VarEnd: return { kind: "event", event: { ...base, action: SoccerAction.VarEnd, outcome: parseVarEndOutcome(data?.Outcome) } };
    case SoccerAction.Possible: return { kind: "event", event: { ...base, action: SoccerAction.Possible, possibleGoal: data?.Goal, possiblePenalty: data?.Penalty, possibleCorner: data?.Corner, possibleYellowCard: data?.YellowCard, possibleRedCard: data?.RedCard, possibleVar: data?.VAR } };
    case SoccerAction.Status: {
      const statusId = data?.StatusId ?? gameStateToStatusId(update.gameState);
      if (statusId === undefined || !isStatusId(statusId)) throw new MalformedScoreUpdateError(`Invalid status for game state ${update.gameState}`);
      return { kind: "event", event: { ...base, action: SoccerAction.Status, statusId } };
    }
    case SoccerAction.ScoreAdjustment: return { kind: "event", event: { ...base, action: SoccerAction.ScoreAdjustment, score: (update.scoreSoccer as Record<string, unknown> | undefined) ?? {} } };
    case SoccerAction.AdditionalTime: return { kind: "event", event: { ...base, action: SoccerAction.AdditionalTime, minutes: data?.Minutes ?? 0 } };
    case SoccerAction.Kickoff: return { kind: "event", event: { ...base, action: SoccerAction.Kickoff } };
    case SoccerAction.Substitution: return { kind: "event", event: { ...base, action: SoccerAction.Substitution, playerInId: data?.PlayerInId ?? 0, playerOutId: data?.PlayerOutId ?? 0 } };
    case SoccerAction.Injury: return { kind: "event", event: { ...base, action: SoccerAction.Injury, playerId: data?.PlayerId, outcome: parseInjuryOutcome(data?.Outcome) } };
    case SoccerAction.Suspend: return { kind: "event", event: { ...base, action: SoccerAction.Suspend, reliable: update.confirmed ?? false } };
    default: return { kind: "unsupported", action: update.action, metadata };
  }
}

function isStatusId(value: number): value is StatusId { return Number.isInteger(value) && value >= 1 && value <= 16; }
function parseParticipant(value: unknown): 1 | 2 | undefined { return value === 1 || value === 2 ? value : undefined; }
function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T { return typeof value === "string" && values.includes(value as T) ? value as T : fallback; }
function parseGoalType(value: unknown): GoalType { return enumValue(value, Object.values(GoalType), GoalType.Shot); }
function parseVarType(value: unknown): VarType { return enumValue(value, Object.values(VarType), VarType.Goal); }
function parseRedCardType(value: unknown): "StraightRed" | "SecondYellow" { return value === "SecondYellow" ? value : "StraightRed"; }
function parsePenaltyOutcome(value: unknown): "Scored" | "Missed" | "Retake" { return value === "Missed" || value === "Retake" ? value : "Scored"; }
function parseShotOutcome(value: unknown): "OnTarget" | "OffTarget" | "Woodwork" | "Blocked" { return value === "OffTarget" || value === "Woodwork" || value === "Blocked" ? value : "OnTarget"; }
function parseVarEndOutcome(value: unknown): "Stands" | "Overturned" { return value === "Overturned" ? value : "Stands"; }
function parseInjuryOutcome(value: unknown): "OnPitch" | "OffPitch" | "NotReturning" | undefined { return value === "OnPitch" || value === "OffPitch" || value === "NotReturning" ? value : undefined; }
