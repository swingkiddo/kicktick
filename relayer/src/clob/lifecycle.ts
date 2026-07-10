import { ClobStore } from "./store";
import { MarketRecord } from "./types";

export interface MarketLocker { lock(market: MarketRecord): Promise<void>; }

/** Durable market lifecycle guard. It prevents a restart from reopening or resolving a market twice. */
export class ClobLifecycle {
  constructor(private readonly store: ClobStore, private readonly locker?: MarketLocker) {}

  open(market: Omit<MarketRecord, "chain_fill_sequence" | "created_at" | "updated_at">): void {
    const existing = this.store.getMarket(market.market);
    if (existing && existing.state !== "OPEN") throw new Error(`market ${market.market} already advanced to ${existing.state}`);
    this.store.upsertMarket(market);
  }

  /** Cancels unmatched orders first, then invokes the on-chain lock exactly once. */
  async freezeAndLock(marketAddress: string): Promise<void> {
    const market = this.store.getMarket(marketAddress);
    if (!market) throw new Error(`unknown market ${marketAddress}`);
    if (market.state === "LOCKED" || market.state === "RESOLVED_PENDING" || market.state === "RESOLVED" || market.state === "VOIDED") return;
    for (const order of this.store.listOpenOrders(marketAddress)) this.store.cancelOrder(order.id);
    await this.locker?.lock(market);
    this.store.upsertMarket({ ...market, state: "LOCKED" });
  }

  markResolutionPending(marketAddress: string): void { this.transition(marketAddress, ["LOCKED"], "RESOLVED_PENDING"); }
  markResolved(marketAddress: string): void { this.transition(marketAddress, ["RESOLVED_PENDING"], "RESOLVED"); }
  markVoided(marketAddress: string): void { this.transition(marketAddress, ["OPEN", "LOCKED", "RESOLVED_PENDING"], "VOIDED"); }

  /** Solana remains authoritative after a crash; this only mirrors its observed state locally. */
  reconcile(marketAddress: string, state: MarketRecord["state"]): void {
    const market = this.store.getMarket(marketAddress);
    if (!market || market.state === state) return;
    this.store.upsertMarket({ ...market, state });
  }

  private transition(marketAddress: string, allowed: MarketRecord["state"][], next: MarketRecord["state"]): void {
    const market = this.store.getMarket(marketAddress);
    if (!market) throw new Error(`unknown market ${marketAddress}`);
    if (market.state === next) return;
    if (!allowed.includes(market.state)) throw new Error(`cannot move market ${marketAddress} from ${market.state} to ${next}`);
    this.store.upsertMarket({ ...market, state: next });
  }
}
