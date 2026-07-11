import { SoccerAction } from "../types";
import type { CornerEvent, RedCardEvent, YellowCardEvent } from "../events";
import type { EventHandler } from "../event-parser-types";

export const parseCardsAndCornersEvent: EventHandler = ({ update, metadata, participant }) => {
  if (update.action === SoccerAction.Corner) {
    const event: CornerEvent = { metadata, participant, action: SoccerAction.Corner };
    return event;
  }
  if (update.action === SoccerAction.YellowCard) {
    const event: YellowCardEvent = {
      metadata, participant, action: SoccerAction.YellowCard,
      playerId: update.dataSoccer?.PlayerId,
    };
    return event;
  }
  if (update.action === SoccerAction.RedCard) {
    const event: RedCardEvent = {
      metadata, participant, action: SoccerAction.RedCard,
      playerId: update.dataSoccer?.PlayerId,
      redCardType: update.dataSoccer?.Type === "SecondYellow" ? "SecondYellow" : "StraightRed",
    };
    return event;
  }
  return undefined;
};
