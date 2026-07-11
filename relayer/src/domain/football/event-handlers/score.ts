import { GoalType, SoccerAction } from "../types";
import type { GoalEvent, ScoreAdjustmentEvent } from "../events";
import type { EventHandler } from "../event-parser-types";

export const parseScoreEvent: EventHandler = ({ update, metadata, participant }) => {
  if (update.action === SoccerAction.Goal) {
    const event: GoalEvent = {
      metadata, participant, action: SoccerAction.Goal,
      goalType: parseGoalType(update.dataSoccer?.GoalType),
      playerId: update.dataSoccer?.PlayerId,
    };
    return event;
  }
  if (update.action === SoccerAction.ScoreAdjustment) {
    const event: ScoreAdjustmentEvent = {
      metadata, participant, action: SoccerAction.ScoreAdjustment,
      score: (update.scoreSoccer as Record<string, unknown> | undefined) ?? {},
    };
    return event;
  }
  return undefined;
};

function parseGoalType(value: unknown): GoalType {
  return typeof value === "string" && Object.values(GoalType).includes(value as GoalType)
    ? value as GoalType
    : GoalType.Shot;
}
