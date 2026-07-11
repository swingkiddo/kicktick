import { SoccerAction } from "../types";
import type {
  AdditionalTimeEvent, FreeKickEvent, GoalKickEvent, InjuryEvent, KickoffEvent,
  PossibleEvent, ShotEvent, SubstitutionEvent, SuspendEvent, ThrowInEvent,
} from "../events";
import type { EventHandler } from "../event-parser-types";

export const parseSecondaryEvent: EventHandler = ({ update, metadata, participant }) => {
  const data = update.dataSoccer;
  switch (update.action) {
    case SoccerAction.Shot: {
      const value = data?.Outcome;
      const event: ShotEvent = { metadata, participant, action: SoccerAction.Shot, outcome: value === "OffTarget" || value === "Woodwork" || value === "Blocked" ? value : "OnTarget" };
      return event;
    }
    case SoccerAction.FreeKick: {
      const event: FreeKickEvent = { metadata, participant, action: SoccerAction.FreeKick, freeKickType: data?.FreeKickType };
      return event;
    }
    case SoccerAction.ThrowIn: {
      const event: ThrowInEvent = { metadata, participant, action: SoccerAction.ThrowIn, throwInType: data?.ThrowInType };
      return event;
    }
    case SoccerAction.GoalKick: return { metadata, participant, action: SoccerAction.GoalKick } satisfies GoalKickEvent;
    case SoccerAction.Possible: return {
      metadata, participant, action: SoccerAction.Possible, possibleGoal: data?.Goal,
      possiblePenalty: data?.Penalty, possibleCorner: data?.Corner,
      possibleYellowCard: data?.YellowCard, possibleRedCard: data?.RedCard, possibleVar: data?.VAR,
    } satisfies PossibleEvent;
    case SoccerAction.AdditionalTime: return { metadata, participant, action: SoccerAction.AdditionalTime, minutes: data?.Minutes ?? 0 } satisfies AdditionalTimeEvent;
    case SoccerAction.Kickoff: return { metadata, participant, action: SoccerAction.Kickoff } satisfies KickoffEvent;
    case SoccerAction.Substitution: return { metadata, participant, action: SoccerAction.Substitution, playerInId: data?.PlayerInId ?? 0, playerOutId: data?.PlayerOutId ?? 0 } satisfies SubstitutionEvent;
    case SoccerAction.Injury: {
      const value = data?.Outcome;
      const outcome = value === "OnPitch" || value === "OffPitch" || value === "NotReturning" ? value : undefined;
      return { metadata, participant, action: SoccerAction.Injury, playerId: data?.PlayerId, outcome } satisfies InjuryEvent;
    }
    case SoccerAction.Suspend: return { metadata, participant, action: SoccerAction.Suspend, reliable: update.confirmed ?? false } satisfies SuspendEvent;
    default: return undefined;
  }
};
