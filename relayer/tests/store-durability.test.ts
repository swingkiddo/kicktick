import { expect } from "chai";
import { ClobStore } from "../src/clob/store";

describe("ClobStore durable relayer state", () => {
  let store: ClobStore;

  beforeEach(() => {
    store = new ClobStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("advances a fixture cursor without accepting duplicate or stale sequences", () => {
    expect(store.advanceFixtureCursor("42", 10)).to.equal(true);
    expect(store.advanceFixtureCursor("42", 10)).to.equal(false);
    expect(store.advanceFixtureCursor("42", 9)).to.equal(false);
    expect(store.getFixtureCursor("42")?.last_seq).to.equal(10);
    expect(store.advanceFixtureCursor("42", 11)).to.equal(true);
    expect(store.getFixtureCursor("42")?.last_seq).to.equal(11);
  });

  it("persists and transitions recovery actions", () => {
    store.upsertMarket({
      market: "market-42", fixture_id: "42", market_type: "NextGoalSide", market_seq: "1",
      outcome_count: 3, expires_at: 1_800_000_000, state: "LOCKED",
    });
    store.insertMarketAction({
      id: "resolve-42-1", fixture_id: "42", market: "market-42", action_type: "RESOLVE_ONCHAIN",
      payload_json: JSON.stringify({ settlementSeq: 101 }), status: "PENDING",
    });

    store.markMarketActionRunning("resolve-42-1");
    expect(store.getMarketAction("resolve-42-1")).to.include({ status: "RUNNING", attempts: 1 });

    store.updateMarketAction("resolve-42-1", "FAILED", "proof unavailable");
    expect(store.getMarketAction("resolve-42-1")).to.include({ status: "FAILED", error: "proof unavailable" });
  });
});
