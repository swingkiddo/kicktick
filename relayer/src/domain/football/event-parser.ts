import type { NormalizedSseData } from "../../infrastructure/txline/score-mapper";
import type { FootballEvent, FootballEventMetadata } from "./events";
import type { EventParserContext } from "./event-parser-types";
import { MalformedScoreUpdateError } from "./event-parser-errors";
import { parseCardsAndCornersEvent } from "./event-handlers/cards-corners";
import { parsePenaltyEvent } from "./event-handlers/penalties";
import { parseScoreEvent } from "./event-handlers/score";
import { parseSecondaryEvent } from "./event-handlers/secondary";
import { gameStateToStatusId, parseStatusEvent } from "./event-handlers/status";
import { parseVarEvent } from "./event-handlers/var";

export type EventParseResult =
  | { kind: "event"; event: FootballEvent }
  | { kind: "unsupported"; action: string; metadata: FootballEventMetadata };

export { gameStateToStatusId };
export { MalformedScoreUpdateError };

const EVENT_HANDLERS = [
  parseStatusEvent,
  parseScoreEvent,
  parseCardsAndCornersEvent,
  parsePenaltyEvent,
  parseVarEvent,
  parseSecondaryEvent,
];

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
  const context: EventParserContext = {
    update,
    metadata,
    participant: parseParticipant(update.participant ?? update.dataSoccer?.Participant),
  };
  for (const handler of EVENT_HANDLERS) {
    const event = handler(context);
    if (event) return { kind: "event", event };
  }
  return { kind: "unsupported", action: update.action, metadata };
}

function parseParticipant(value: unknown): 1 | 2 | undefined {
  return value === 1 || value === 2 ? value : undefined;
}
