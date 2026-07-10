import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ClobLifecycle } from "../src/clob/lifecycle";
import { ClobStore } from "../src/clob/store";
import { MarketActionExecutor } from "../src/market/action-executor";
import { MarketType } from "../src/market/event-parser";
import { TriggerAction } from "../src/market/triggers";

describe("MarketActionExecutor", () => {
  let store: ClobStore;
  let calls: TriggerAction[];
  let executor: MarketActionExecutor;
  let programId: PublicKey;

  beforeEach(() => {
    store = new ClobStore(":memory:");
    calls = [];
    programId = Keypair.generate().publicKey;
    executor = new MarketActionExecutor(
      store,
      new ClobLifecycle(store, { lock: async () => undefined }),
      { drain: async () => undefined },
      { executeAction: async (action) => { calls.push(action); return "signature"; } },
      programId,
    );
  });

  afterEach(() => store.close());

  const open = (): Extract<TriggerAction, { type: "open_market" }> => ({
    type: "open_market", fixtureId: 42, matchPda: "match", marketSeq: 1,
    marketType: MarketType.NextGoalSide, lockSeconds: 15, deadlineSeconds: 90,
  });

  it("creates a market once before accepting its resolution", async () => {
    const action = open();
    await executor.enqueue([action, action]);
    expect(calls).to.have.length(1);

    const resolve: TriggerAction = {
      type: "resolve_market_onchain", fixtureId: 42, matchPda: "match", marketSeq: 1,
      marketType: MarketType.NextGoalSide, settlementSeq: 99,
    };
    await executor.enqueue([resolve]);

    const market = store.listMarkets()[0];
    expect(market.state).to.equal("RESOLVED_PENDING");
    expect(store.listMarketActions(["CONFIRMED"])).to.have.length(1);
    expect(calls.map((call) => call.type)).to.deep.equal(["open_market", "resolve_market_onchain"]);
  });

  it("does not confirm a market when resolution failed", async () => {
    const action = open();
    await executor.enqueue([action]);
    calls = [];
    const failing = new MarketActionExecutor(
      store,
      new ClobLifecycle(store, { lock: async () => undefined }),
      { drain: async () => undefined },
      { executeAction: async () => { throw new Error("proof unavailable"); } },
      programId,
    );
    const resolve: TriggerAction = {
      type: "resolve_market_onchain", fixtureId: 42, matchPda: "match", marketSeq: 1,
      marketType: MarketType.NextGoalSide, settlementSeq: 99,
    };
    await failing.enqueue([resolve]).then(
      () => expect.fail("resolution should fail"),
      (error: Error) => expect(error.message).to.equal("proof unavailable"),
    );
    const market = store.listMarkets()[0];
    expect(market.state).to.equal("LOCKED");
    expect(store.listMarketActions(["FAILED"])).to.have.length(1);
  });
});
