import { SoccerAction } from "../types";
import type { PenaltyAwardedEvent, PenaltyOutcomeEvent } from "../events";
import type { EventHandler } from "../event-parser-types";

export const parsePenaltyEvent: EventHandler = ({ update, metadata, participant }) => {
  if (update.action === SoccerAction.Penalty) {
    const event: PenaltyAwardedEvent = { metadata, participant, action: SoccerAction.Penalty };
    return event;
  }
  if (update.action === SoccerAction.PenaltyOutcome) {
    const value = update.dataSoccer?.Outcome;
    const event: PenaltyOutcomeEvent = {
      metadata, participant, action: SoccerAction.PenaltyOutcome,
      outcome: value === "Missed" || value === "Retake" ? value : "Scored",
    };
    return event;
  }
  return undefined;
};
