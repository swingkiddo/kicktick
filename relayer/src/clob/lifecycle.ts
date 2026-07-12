import { ClobStore } from "./store";
import type { MarketRecord } from "../domain/markets";

export interface MarketLocker {
  lock(market: MarketRecord): Promise<void>;
  getState?(market: MarketRecord): Promise<MarketRecord["state"]>;
}
export interface MarketCleanup { enqueueMarket(market: string): unknown[]; processPending(market?: string): Promise<void>; }

/** Durable market lifecycle guard. It prevents a restart from reopening or resolving a market twice. */
export class ClobLifecycle {
  constructor(private readonly store: ClobStore, private readonly locker?: MarketLocker, private readonly cleanup?: MarketCleanup) {}

  open(market: Omit<MarketRecord, "chain_fill_sequence" | "created_at" | "updated_at">): void {
    const existing = this.store.getMarket(market.market);
    if (existing && existing.state !== "OPEN") throw new Error(`market ${market.market} already advanced to ${existing.state}`);
    this.store.upsertMarket(market);
  }

  beginLocking(marketAddress: string): void {
    const market = this.store.getMarket(marketAddress);
    if (!market) throw new Error(`unknown market ${marketAddress}`);
    if (market.state === "LOCKED" || market.state === "RESOLVED_PENDING" || market.state === "RESOLVED" || market.state === "VOIDED") return;
    if (market.state !== "OPEN" && market.state !== "LOCKING") throw new Error(`cannot lock market ${marketAddress} from ${market.state}`);
    this.store.upsertMarket({ ...market, state: "LOCKING" });
  }

  async lockAndCleanup(marketAddress: string): Promise<void> {
    const market = this.store.getMarket(marketAddress);
    if (!market) throw new Error(`unknown market ${marketAddress}`);
    if (["RESOLVED_PENDING", "RESOLVED", "VOIDED"].includes(market.state)) return;
    if (market.state === "OPEN") this.beginLocking(marketAddress);
    let current = this.store.getMarket(marketAddress)!;
    if (current.state === "LOCKING") {
      const chainState = await this.locker?.getState?.(current);
      if (chainState && chainState !== "OPEN") {
        this.reconcile(marketAddress, chainState);
        current = this.store.getMarket(marketAddress)!;
      } else {
        await this.locker?.lock(current);
      }
    }
    if (["RESOLVED_PENDING", "RESOLVED", "VOIDED"].includes(current.state)) return;
    this.cleanup?.enqueueMarket(marketAddress);
    await this.cleanup?.processPending(marketAddress);
    if (this.store.listCleanupIntents(["PENDING", "RUNNING", "FAILED"], marketAddress).length) throw new Error(`market ${marketAddress} still has pending order cleanup`);
    this.store.upsertMarket({ ...this.store.getMarket(marketAddress)!, state: "LOCKED" });
  }

  async freezeAndLock(marketAddress: string): Promise<void> {
    this.beginLocking(marketAddress);
    await this.lockAndCleanup(marketAddress);
  }

  markResolutionPending(marketAddress: string): void { this.transition(marketAddress, ["LOCKED"], "RESOLVED_PENDING"); }
  markResolved(marketAddress: string): void { this.transition(marketAddress, ["RESOLVED_PENDING"], "RESOLVED"); }
  markVoided(marketAddress: string): void { this.transition(marketAddress, ["OPEN", "LOCKING", "LOCKED", "RESOLVED_PENDING"], "VOIDED"); }

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
