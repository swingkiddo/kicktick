import { EventEmitter } from "events";
import { AnchorClient } from "../clients/anchor-client";
import { ClobStore } from "./store";
import { Fill } from "./types";

/** One queue per market prevents Solana account lock contention while separate markets run concurrently. */
export class FillSettlementQueue extends EventEmitter {
  private readonly tails = new Map<string, Promise<void>>();

  constructor(private readonly store: ClobStore, private readonly anchor: AnchorClient) { super(); }

  submit(fill: Fill): Promise<void> {
    const previous = this.tails.get(fill.market) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.settle(fill));
    this.tails.set(fill.market, next);
    return next.finally(() => { if (this.tails.get(fill.market) === next) this.tails.delete(fill.market); });
  }

  /** Wait until all fills already queued for a market have reached a terminal state. */
  drain(market: string): Promise<void> {
    return this.tails.get(market) ?? Promise.resolve();
  }

  private async settle(fill: Fill): Promise<void> {
    try {
      const signature = fill.kind === "COMPLETE_SET"
        ? await this.anchor.settleCompleteSetFill(fill, [...fill.maker_order_ids, ...fill.taker_order_ids]
          .map(id => {
            const order = this.store.getOrder(id);
            if (!order) throw new Error(`missing complete-set order ${id}`);
            return order;
          })
          .sort((a, b) => a.outcome_index - b.outcome_index)
          .map(order => order.owner))
        : await this.anchor.settleClobFill(fill);
      this.store.markFillSubmitted(fill.id, signature);
      this.store.confirmFill(fill.id);
      this.emit("confirmed", this.store.getFill(fill.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The fill stays durable as FAILED and reservations are released. A caller can
      // reconcile an ambiguous submitted signature before deciding to retry.
      this.store.releaseFill(fill.id, message);
      this.emit("failed", this.store.getFill(fill.id), error);
      throw error;
    }
  }

  async reconcile(): Promise<{ confirmed: string[]; retry: string[] }> {
    const confirmed: string[] = [], retry: string[] = [];
    for (const fill of this.store.listPendingFills()) {
      const next = await this.anchor.getNextFillSequence(fill.market);
      if (next > fill.market_sequence) {
        this.store.confirmFill(fill.id);
        confirmed.push(fill.id);
      } else {
        retry.push(fill.id);
      }
    }
    return { confirmed, retry };
  }
}
