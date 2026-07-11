import type { NormalizedSseData } from "../../infrastructure/txline/score-mapper";
import type { FootballEvent, FootballEventMetadata } from "./events";

export interface EventParserContext {
  update: NormalizedSseData;
  metadata: FootballEventMetadata;
  participant?: 1 | 2;
}

export type EventHandler = (context: EventParserContext) => FootballEvent | undefined;
