import { ClobStore } from "./store";
import { MatchingEngine } from "./matching-engine";

export interface ChainFillReader {
  /** Returns the next fill sequence expected by the market account. */
  getNextFillSequence(market: string): Promise<bigint>;
}

/** Restores books and makes ambiguous submissions explicit instead of replaying them blindly. */
export class ClobRecovery {
  constructor(private readonly store: ClobStore, private readonly engine: MatchingEngine) {}

  async recover(chain: ChainFillReader): Promise<{ restored_orders: number; confirmed_fills: string[]; retry_fills: string[] }> {
    const restored_orders = this.engine.reconstruct().size;
    const confirmed_fills: string[] = [];
    const retry_fills: string[] = [];
    for (const fill of this.store.listPendingFills()) {
      const next = await chain.getNextFillSequence(fill.market);
      // A chain sequence after ours proves this fill applied (fills are serialized per market).
      if (next > fill.market_sequence) {
        this.store.confirmFill(fill.id);
        confirmed_fills.push(fill.id);
        continue;
      }
      const market = this.store.getMarket(fill.market);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!market || market.state !== "OPEN" || nowSeconds >= market.expires_at) {
        const reason = !market
          ? `fill ${fill.id} cancelled during recovery: market is missing`
          : `fill ${fill.id} cancelled during recovery: market is ${market.state}${nowSeconds >= market.expires_at ? " and expired" : ""}`;
        this.store.cancelFill(fill.id, reason);
        continue;
      }
      if (fill.status === "MATCHED" || next === fill.market_sequence) {
        retry_fills.push(fill.id);
      }
    }
    return { restored_orders, confirmed_fills, retry_fills };
  }
}
