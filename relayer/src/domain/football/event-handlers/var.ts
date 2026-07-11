import { SoccerAction, VarType } from "../types";
import type { VarCheckEvent, VarEndEvent } from "../events";
import type { EventHandler } from "../event-parser-types";

export const parseVarEvent: EventHandler = ({ update, metadata, participant }) => {
  if (update.action === SoccerAction.Var) {
    const value = update.dataSoccer?.Type;
    const event: VarCheckEvent = {
      metadata, participant, action: SoccerAction.Var,
      varType: Object.values(VarType).includes(value as VarType) ? value as VarType : VarType.Goal,
    };
    return event;
  }
  if (update.action === SoccerAction.VarEnd) {
    const event: VarEndEvent = {
      metadata, participant, action: SoccerAction.VarEnd,
      outcome: update.dataSoccer?.Outcome === "Overturned" ? "Overturned" : "Stands",
    };
    return event;
  }
  return undefined;
};
