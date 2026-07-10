import { createHash } from "crypto";
import { ClobStore } from "./store";
import { Fill, MarketRecord, MIN_TRADE_QUANTITY, StoredOrder } from "./types";

export interface MatchResult {
  fills: Fill[];
  expired_order_ids: string[];
}

const available = (order: StoredOrder): bigint => order.remaining_quantity - order.pending_quantity;
const priority = (a: StoredOrder, b: StoredOrder): number => a.priority_at - b.priority_at || a.id.localeCompare(b.id);

/**
 * Deterministic price-time matcher. Matching is deliberately synchronous: a caller
 * reserves fills in SQLite before handing them to a per-market settlement queue.
 */
export class MatchingEngine {
  constructor(private readonly store: ClobStore) {}

  reconstruct(): Map<string, StoredOrder[]> {
    const books = new Map<string, StoredOrder[]>();
    for (const order of this.store.listOpenOrders()) {
      const key = `${order.market}:${order.outcome_index}:${order.side}`;
      const book = books.get(key) ?? [];
      book.push(order);
      books.set(key, book);
    }
    for (const orders of books.values()) orders.sort(priority);
    return books;
  }

  cancel(orderId: string, owner: string): boolean { return this.store.cancelOrder(orderId, owner); }
  cancelAll(owner: string, market?: string): string[] {
    const ids: string[] = [];
    for (const order of this.store.listOwnerOrders(owner, market)) if (this.store.cancelOrder(order.id, owner)) ids.push(order.id);
    return ids;
  }

  match(market: MarketRecord, nowSeconds = Math.floor(Date.now() / 1000)): MatchResult {
    const expired_order_ids = this.store.expireOrders(nowSeconds);
    if (market.state !== "OPEN" || nowSeconds >= market.expires_at - 2) return { fills: [], expired_order_ids };
    const fills: Fill[] = [];
    let sequence = this.store.nextFillSequence(market.market, market.chain_fill_sequence);

    // Repeat until neither direct nor complete-set matching can progress. Re-read
    // after every reservation so pending quantity participates in availability.
    for (;;) {
      const orders = this.store.listOpenOrders(market.market).filter(order => available(order) > 0n && order.expires_at > nowSeconds);
      const direct = this.nextDirect(market, orders, sequence);
      const complete = direct ? undefined : this.nextCompleteSet(market, orders, sequence);
      const fill = direct ?? complete;
      if (!fill) break;
      const quantities = new Map<string, bigint>();
      for (const id of [...fill.maker_order_ids, ...fill.taker_order_ids]) quantities.set(id, fill.quantity);
      this.store.reserveFill(fill, quantities);
      fills.push(fill);
      sequence++;
    }
    return { fills, expired_order_ids };
  }

  private nextDirect(market: MarketRecord, orders: StoredOrder[], sequence: bigint): Fill | undefined {
    for (let outcome = 0; outcome < market.outcome_count; outcome++) {
      const buys = orders.filter(o => o.outcome_index === outcome && o.side === "BUY").sort((a, b) => b.price_bps - a.price_bps || priority(a, b));
      const sells = orders.filter(o => o.outcome_index === outcome && o.side === "SELL").sort((a, b) => a.price_bps - b.price_bps || priority(a, b));
      const pair = buys.flatMap(buy => sells.filter(sell => sell.owner !== buy.owner && buy.price_bps >= sell.price_bps).map(sell => ({ buy, sell })))[0];
      if (!pair) continue;
      const { buy, sell } = pair;
      const maker = priority(buy, sell) <= 0 ? buy : sell;
      const taker = maker.id === buy.id ? sell : buy;
      const quantity = available(buy) < available(sell) ? available(buy) : available(sell);
      if (quantity < MIN_TRADE_QUANTITY) continue;
      return this.fill({
        market: market.market, market_sequence: sequence, kind: "DIRECT", maker_order_ids: [maker.id], taker_order_ids: [taker.id],
        buyer: buy.owner, seller: sell.owner, outcome_index: outcome, prices_bps: [maker.price_bps], quantity,
      });
    }
    return undefined;
  }

  private nextCompleteSet(market: MarketRecord, orders: StoredOrder[], sequence: bigint): Fill | undefined {
    const selected: StoredOrder[] = [];
    for (let outcome = 0; outcome < market.outcome_count; outcome++) {
      const order = orders.filter(o => o.outcome_index === outcome && o.side === "BUY").sort((a, b) => priority(a, b))[0];
      if (!order) return undefined;
      selected.push(order);
    }
    // The newest accepted order is taker. It pays the exact residual so the
    // basket totals 10,000 bps, while every older maker retains its limit price.
    const taker = selected.slice().sort((a, b) => priority(b, a))[0];
    const makerSum = selected.filter(order => order.id !== taker.id).reduce((sum, order) => sum + order.price_bps, 0);
    const residual = 10_000 - makerSum;
    if (residual < 100 || residual > 9_900 || residual % 100 !== 0 || residual > taker.price_bps) return undefined;
    const quantity = selected.map(available).reduce((smallest, current) => current < smallest ? current : smallest);
    if (quantity < MIN_TRADE_QUANTITY || new Set(selected.map(order => order.owner)).size !== selected.length) return undefined;
    const prices = selected.map(order => order.id === taker.id ? residual : order.price_bps);
    const makers = selected.filter(order => order.id !== taker.id).sort(priority);
    return this.fill({
      market: market.market, market_sequence: sequence, kind: "COMPLETE_SET", maker_order_ids: makers.map(order => order.id),
      taker_order_ids: [taker.id], prices_bps: prices, quantity,
    });
  }

  private fill(fill: Omit<Fill, "id" | "status" | "created_at" | "updated_at">): Fill {
    const id = createHash("sha256").update(JSON.stringify({ ...fill, market_sequence: fill.market_sequence.toString(), quantity: fill.quantity.toString() })).digest("hex");
    const now = Date.now();
    return { ...fill, id, status: "MATCHED", created_at: now, updated_at: now };
  }
}
