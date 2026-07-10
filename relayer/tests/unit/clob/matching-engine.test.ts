import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { MatchingEngine } from "../../../src/clob/matching-engine";
import { ClobStore } from "../../../src/clob/store";
import type { MarketRecord, StoredOrder } from "../../../src/clob/types";

const market = Keypair.generate().publicKey.toBase58();
const owner = () => Keypair.generate().publicKey.toBase58();
function order(overrides: Partial<StoredOrder> = {}): StoredOrder {
  const now = 1_000;
  return {
    id: Keypair.generate().publicKey.toBase58().padEnd(64, "0").slice(0, 64), version: 1, network: "devnet", program_id: Keypair.generate().publicKey.toBase58(), market,
    owner: owner(), signature: "signature", side: "BUY", outcome_index: 0, price_bps: 3000, quantity: "1000", nonce: String(Math.random() * 1e9), expires_at: 2_000_000_000,
    original_quantity: 1000n, remaining_quantity: 1000n, pending_quantity: 0n, status: "OPEN", priority_at: now, created_at: now, updated_at: now, ...overrides,
  };
}
function setup(outcome_count: number): { store: ClobStore; engine: MatchingEngine; record: MarketRecord } {
  const store = new ClobStore(":memory:");
  store.upsertMarket({ market, fixture_id: "1", market_type: "NextGoalSide", market_seq: "1", outcome_count, expires_at: 2_000_000_000, state: "OPEN" });
  return { store, engine: new MatchingEngine(store), record: store.getMarket(market)! };
}

describe("CLOB matching engine", () => {
  it("uses price-time priority for direct partial fills", () => {
    const { store, engine, record } = setup(2);
    const earlySell = order({ side: "SELL", outcome_index: 0, price_bps: 4000, priority_at: 1, remaining_quantity: 400n, original_quantity: 400n, quantity: "400" });
    const laterSell = order({ side: "SELL", outcome_index: 0, price_bps: 4000, priority_at: 2 });
    const buy = order({ side: "BUY", outcome_index: 0, price_bps: 5000, priority_at: 3 });
    store.insertOrder(earlySell); store.insertOrder(laterSell); store.insertOrder(buy);
    const result = engine.match(record, 1_900_000_000);
    expect(result.fills).to.have.length(2);
    expect(result.fills[0].maker_order_ids).to.deep.equal([earlySell.id]);
    expect(result.fills[0].quantity).to.equal(400n);
    expect(result.fills[1].maker_order_ids).to.deep.equal([laterSell.id]);
    expect(result.fills[1].quantity).to.equal(600n);
  });

  it("makes ternary complete sets with the newest order receiving residual price", () => {
    const { store, engine, record } = setup(3);
    const one = order({ outcome_index: 0, price_bps: 2000, priority_at: 1 });
    const two = order({ outcome_index: 1, price_bps: 3000, priority_at: 2 });
    const three = order({ outcome_index: 2, price_bps: 6000, priority_at: 3 });
    store.insertOrder(one); store.insertOrder(two); store.insertOrder(three);
    const [fill] = engine.match(record, 1_900_000_000).fills;
    expect(fill.kind).to.equal("COMPLETE_SET");
    expect(fill.prices_bps).to.deep.equal([2000, 3000, 5000]);
    expect(fill.quantity).to.equal(1000n);
    expect(store.getOrder(three.id)!.pending_quantity).to.equal(1000n);
  });

  it("restores durable books and releases reservations after failed settlement", () => {
    const { store, engine, record } = setup(2);
    const buy = order({ outcome_index: 0, price_bps: 5000 });
    const sell = order({ side: "SELL", outcome_index: 0, price_bps: 5000, priority_at: 2 });
    store.insertOrder(buy); store.insertOrder(sell);
    const [fill] = engine.match(record, 1_900_000_000).fills;
    expect(engine.reconstruct().get(`${market}:0:BUY`)![0].id).to.equal(buy.id);
    store.releaseFill(fill.id, "rpc timeout");
    expect(store.getOrder(buy.id)!.pending_quantity).to.equal(0n);
    expect(store.getFill(fill.id)!.status).to.equal("FAILED");
  });
});
