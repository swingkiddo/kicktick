import { SoccerAction, StatusId } from "../types";
import type { StatusChangeEvent } from "../events";
import type { EventHandler } from "../event-parser-types";
import { MalformedScoreUpdateError } from "../event-parser-errors";

const GAME_STATE_STATUS: Record<string, StatusId> = {
  NS: StatusId.NotStarted, H1: StatusId.FirstHalf, HT: StatusId.HalfTime,
  H2: StatusId.SecondHalf, F: StatusId.FullTime, WET: StatusId.WaitingExtraTime,
  ET1: StatusId.ExtraTimeFirstHalf, HTET: StatusId.ExtraTimeHalfTime,
  ET2: StatusId.ExtraTimeSecondHalf, FET: StatusId.FinishedAfterExtraTime,
  WPE: StatusId.WaitingPenaltyShootout, PE: StatusId.PenaltyShootout,
  FPE: StatusId.FinishedAfterPenaltyShootout, I: StatusId.Interrupted,
  A: StatusId.Abandoned, C: StatusId.Cancelled,
};

export function gameStateToStatusId(gameState: string): StatusId | undefined {
  return GAME_STATE_STATUS[gameState];
}

function isStatusId(value: number): value is StatusId {
  return Number.isInteger(value) && value >= 1 && value <= 16;
}

export const parseStatusEvent: EventHandler = ({ update, metadata, participant }) => {
  if (update.action !== SoccerAction.Status) return undefined;

  const statusId = update.dataSoccer?.StatusId ?? gameStateToStatusId(update.gameState);
  if (statusId === undefined || !isStatusId(statusId)) {
    throw new MalformedScoreUpdateError(`Invalid status for game state ${update.gameState}`);
  }
  const event: StatusChangeEvent = { metadata, participant, action: SoccerAction.Status, statusId };
  return event;
};
