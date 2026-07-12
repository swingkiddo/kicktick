import { ClobStore } from "./store";
import type { CleanupActionType, CleanupIntent, StoredOrder } from "./types";

export interface OrderCleanupClient {
  expireOrder(order: StoredOrder): Promise<string>;
  cancelOrderAfterLock(order: StoredOrder): Promise<string>;
  orderExists(orderPda: string): Promise<boolean>;
}

/** Executes durable order releases and only publishes terminal local state after chain proof. */
export class OrderCleanupProcessor {
  constructor(private readonly store: ClobStore, private readonly chain: OrderCleanupClient) {}

  enqueueExpired(nowSeconds = Math.floor(Date.now() / 1000)): CleanupIntent[] {
    return this.store.listExpiredOrders(nowSeconds).map(order => this.store.createCleanupIntent(order, "EXPIRE"));
  }

  enqueueMarket(market: string): CleanupIntent[] {
    return this.store.listOpenOrders(market).map(order => this.store.createCleanupIntent(order, "CANCEL_AFTER_LOCK"));
  }

  async processPending(market?: string): Promise<void> {
    const failures: string[] = [];
    for (const intent of this.store.listCleanupIntents(["PENDING", "RUNNING", "FAILED"], market)) {
      try {
        await this.process(intent);
      } catch (error) {
        failures.push(`${intent.order_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length) throw new Error(`order cleanup failed: ${failures.join("; ")}`);
  }

  private async process(intent: CleanupIntent): Promise<void> {
    const order = this.store.getOrder(intent.order_id);
    if (!order) {
      this.store.failCleanup(intent.id, `local order ${intent.order_id} is missing`);
      return;
    }
    this.store.markCleanupRunning(intent.id);
    try {
      // Both program instructions close OrderAccount. Absence proves the release
      // already committed and makes restart recovery idempotent.
      if (!(await this.chain.orderExists(intent.order_pda))) {
        this.store.confirmCleanup(intent.id);
        return;
      }
      const signature = await this.submit(intent.action_type, order);
      if (await this.chain.orderExists(intent.order_pda)) {
        throw new Error(`order ${intent.order_pda} still exists after confirmed cleanup ${signature}`);
      }
      this.store.confirmCleanup(intent.id, signature);
    } catch (error) {
      this.store.failCleanup(intent.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private submit(action: CleanupActionType, order: StoredOrder): Promise<string> {
    return action === "EXPIRE" ? this.chain.expireOrder(order) : this.chain.cancelOrderAfterLock(order);
  }
}
