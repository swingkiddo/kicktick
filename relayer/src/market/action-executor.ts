import { PublicKey } from "@solana/web3.js";
import { ClobLifecycle } from "../clob/lifecycle";
import { ClobStore } from "../clob/store";
import { MarketRecord } from "../clob/types";
import { FillSettlementQueue } from "../clob/settlement";
import { AnchorClient, MarketType as AnchorMarketType } from "../clients/anchor-client";
import { TriggerAction } from "./triggers";

export interface CrankActionRunner {
  executeAction(action: TriggerAction): Promise<string>;
}

export interface MarketActionExecutorOptions {
  onMarketChanged?: (market: string) => void;
}

/**
 * Serializes lifecycle operations per fixture and persists resolution intent
 * before a transaction is submitted. The chain transaction is the boundary for
 * every SQLite state transition.
 */
export class MarketActionExecutor {
  private readonly tails = new Map<number, Promise<void>>();

  constructor(
    private readonly store: ClobStore,
    private readonly lifecycle: ClobLifecycle,
    private readonly fillSettlement: Pick<FillSettlementQueue, "drain">,
    private readonly crank: CrankActionRunner,
    private readonly programId: PublicKey,
    private readonly options: MarketActionExecutorOptions = {},
  ) {}

  enqueue(actions: TriggerAction[]): Promise<void> {
    return Promise.all(actions.map((action) => this.enqueueOne(action))).then(() => undefined);
  }

  private enqueueOne(action: TriggerAction): Promise<void> {
    const previous = this.tails.get(action.fixtureId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.execute(action));
    this.tails.set(action.fixtureId, next);
    return next.finally(() => {
      if (this.tails.get(action.fixtureId) === next) this.tails.delete(action.fixtureId);
    });
  }

  private marketAddress(action: TriggerAction): string {
    const typeIndex = AnchorClient.marketTypeIndex(action.marketType as AnchorMarketType);
    if (typeIndex < 0) throw new Error(`unknown market type ${action.marketType}`);
    return AnchorClient.deriveMarketPda(BigInt(action.fixtureId), typeIndex, BigInt(action.marketSeq), this.programId)[0].toBase58();
  }

  private marketFor(action: TriggerAction): MarketRecord {
    const market = this.store.getMarket(this.marketAddress(action));
    if (!market) throw new Error(`market ${action.fixtureId}:${action.marketSeq} is not available in the CLOB`);
    return market;
  }

  private async execute(action: TriggerAction): Promise<void> {
    if (action.type === "open_market") return this.open(action);
    if (action.type === "confirm_market") return this.confirm(action);
    return this.resolve(action);
  }

  private async open(action: Extract<TriggerAction, { type: "open_market" }>): Promise<void> {
    const market = this.marketAddress(action);
    const existing = this.store.getMarket(market);
    if (existing) return;

    await this.crank.executeAction(action);
    this.lifecycle.open({
      market,
      fixture_id: String(action.fixtureId),
      market_type: action.marketType,
      market_seq: String(action.marketSeq),
      outcome_count: ["NextGoalSide", "NextCorner", "NextYellowCard", "PenaltyShootoutShot"].includes(action.marketType) ? 3 : 2,
      expires_at: Math.floor(Date.now() / 1000) + action.deadlineSeconds,
      state: "OPEN",
    });
    this.changed(market);
  }

  private async resolve(action: Extract<TriggerAction, { type: "resolve_market_onchain" | "resolve_market_offchain" }>): Promise<void> {
    const market = this.marketFor(action);
    if (["RESOLVED_PENDING", "RESOLVED", "VOIDED"].includes(market.state)) return;

    await this.fillSettlement.drain(market.market);
    await this.lifecycle.freezeAndLock(market.market);
    const actionId = `${market.market}:${action.type}`;
    this.store.insertMarketAction({
      id: actionId,
      fixture_id: String(action.fixtureId),
      market: market.market,
      action_type: action.type === "resolve_market_onchain" ? "RESOLVE_ONCHAIN" : "RESOLVE_OFFCHAIN",
      payload_json: JSON.stringify(action),
      status: "PENDING",
    });
    this.store.markMarketActionRunning(actionId);

    try {
      await this.crank.executeAction(action);
      this.lifecycle.markResolutionPending(market.market);
      this.store.updateMarketAction(actionId, "CONFIRMED");
      this.changed(market.market);
    } catch (error) {
      this.store.updateMarketAction(actionId, "FAILED", error instanceof Error ? error.message : String(error));
      this.changed(market.market);
      throw error;
    }
  }

  private async confirm(action: Extract<TriggerAction, { type: "confirm_market" }>): Promise<void> {
    const market = this.marketFor(action);
    if (market.state === "RESOLVED") return;
    if (market.state !== "RESOLVED_PENDING") throw new Error(`cannot confirm market ${market.market} from ${market.state}`);

    const actionId = `${market.market}:confirm_market`;
    this.store.insertMarketAction({
      id: actionId,
      fixture_id: String(action.fixtureId),
      market: market.market,
      action_type: "CONFIRM",
      payload_json: JSON.stringify(action),
      status: "PENDING",
    });
    this.store.markMarketActionRunning(actionId);

    try {
      await this.crank.executeAction(action);
      this.lifecycle.markResolved(market.market);
      this.store.updateMarketAction(actionId, "CONFIRMED");
      this.changed(market.market);
    } catch (error) {
      this.store.updateMarketAction(actionId, "FAILED", error instanceof Error ? error.message : String(error));
      this.changed(market.market);
      throw error;
    }
  }

  private changed(market: string): void {
    this.options.onMarketChanged?.(market);
  }
}
