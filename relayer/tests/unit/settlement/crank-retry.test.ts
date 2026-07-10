import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { Crank } from "../../../src/settlement/crank";
import {
  ProofGatherer,
  ProofData,
  ProofNotReadyError,
} from "../../../src/settlement/proof-gatherer";
import { AnchorClient } from "../../../src/clients/anchor-client";
import { MarketType } from "../../../src/market/event-parser";
import { TriggerAction } from "../../../src/market/triggers";

function makeProofData(statKey: number, value: number): ProofData {
  return {
    ts: 1,
    fixtureSummary: {
      fixture_id: 18187298,
      update_stats: { update_count: 1, min_timestamp: 1, max_timestamp: 1 },
      events_sub_tree_root: [0],
    },
    fixtureProof: [],
    mainTreeProof: [],
    predicate: { threshold: 0, comparison: "GreaterThan" },
    statA: {
      stat_to_prove: { key: statKey, value, period: 0 },
      event_stat_root: [0],
      stat_proof: [],
    },
    statB: null,
    op: null,
  };
}

function makeAnchorMock(): AnchorClient {
  const client = Object.create(AnchorClient.prototype);
  (client as any).program = {
    programId: PublicKey.unique(),
    methods: {
      settleRound: () => ({
        accountsStrict: () => ({
          transaction: () => ({ instructions: [] }),
        }),
      }),
    },
  };
  (client as any).provider = {
    wallet: { publicKey: PublicKey.unique() },
    sendAndConfirm: async () => "mock-tx-sig",
  };
  (client as any).config = {
    kicktickProgramId: PublicKey.unique(),
    txoracleProgramId: PublicKey.unique(),
  };
  return client;
}

function makeProofGathererMock(
  gatherImpl: (fixtureId: number, seq: number, statKey: number, period: number) => Promise<ProofData>,
): { gatherer: ProofGatherer; calls: number } {
  const calls = { count: 0 };
  const gatherer = Object.create(ProofGatherer.prototype);
  (gatherer as any).client = {};
  (gatherer as any).gatherProof = async (
    fixtureId: number,
    seq: number,
    statKey: number,
    period: number,
  ) => {
    calls.count += 1;
    return gatherImpl(fixtureId, seq, statKey, period);
  };
  return { gatherer: gatherer as ProofGatherer, calls };
}

const baseSettleAction: TriggerAction & { type: "resolve_market_onchain" } = {
  type: "resolve_market_onchain",
  fixtureId: 18187298,
  matchPda: PublicKey.unique().toBase58(),
  marketSeq: 1,
  marketType: MarketType.CornerInWindow,
  settlementSeq: 760,
  targetStatKey: 8,
};

const ZERO_BACKOFF = [0, 0, 0, 0];

describe("Crank – gatherProofWithRetry (proof-gather 404 race)", () => {
  beforeEach(() => {
    // EventEmitter throws on unhandled "error" events; tests assert via getStatus().
    // Silence by default; specific tests can register their own listener.
  });

  it("retries on ProofNotReadyError and confirms on 3rd attempt", async () => {
    const { gatherer, calls } = makeProofGathererMock(
      async (_f, _s, statKey) => {
        if (calls.count < 3) {
          throw new ProofNotReadyError("not ready", {
            status: 404,
            body: "A valid, processed scores record for (fixtureId=18187298, seq=760) could not be found.",
            fixtureId: 18187298,
            seq: 760,
            statKey,
          });
        }
        return makeProofData(statKey, 5);
      },
    );
    const anchor = makeAnchorMock();
    const crank = new Crank(anchor, gatherer, { proofBackoffMs: ZERO_BACKOFF });
    crank.on("error", () => {});

    const statuses: string[] = [];
    crank.on("status", (s) => statuses.push(s.status));

    await crank.executeAction(baseSettleAction);

    expect(calls.count).to.equal(3);
    expect(statuses).to.include("confirmed");
    expect(crank.getStatus(18187298, 1)?.status).to.equal("confirmed");
  });

  it("exhausts retry budget on persistent ProofNotReadyError and marks failed", async () => {
    const { gatherer, calls } = makeProofGathererMock(
      async (_f, _s, statKey) => {
        throw new ProofNotReadyError("not ready", {
          status: 404,
          body: "A valid, processed scores record for (fixtureId=18187298, seq=760) could not be found.",
          fixtureId: 18187298,
          seq: 760,
          statKey,
        });
      },
    );
    const anchor = makeAnchorMock();
    const crank = new Crank(anchor, gatherer, { proofBackoffMs: ZERO_BACKOFF });

    const errors: unknown[] = [];
    crank.on("error", (e) => errors.push(e));

    await crank.executeAction(baseSettleAction);

    expect(calls.count).to.equal(4);
    expect(crank.getStatus(18187298, 1)?.status).to.equal("failed");
    expect(crank.getStatus(18187298, 1)?.error).to.match(/not yet ready|not ready/);
    expect(errors.length).to.equal(1);
  });

  it("fails fast on non-retryable error without retry", async () => {
    const { gatherer, calls } = makeProofGathererMock(
      async (_f, _s, _statKey) => {
        throw new Error("network down");
      },
    );
    const anchor = makeAnchorMock();
    const crank = new Crank(anchor, gatherer, { proofBackoffMs: ZERO_BACKOFF });
    crank.on("error", () => {});

    await crank.executeAction(baseSettleAction);

    expect(calls.count).to.equal(1);
    expect(crank.getStatus(18187298, 1)?.status).to.equal("failed");
    expect(crank.getStatus(18187298, 1)?.error).to.equal("network down");
  });

  it("uses custom proofMaxAttempts and backoff schedule", async () => {
    const { gatherer, calls } = makeProofGathererMock(
      async (_f, _s, statKey) => {
        throw new ProofNotReadyError("not ready", {
          status: 404,
          body: "processed scores record could not be found",
          fixtureId: 18187298,
          seq: 760,
          statKey,
        });
      },
    );
    const anchor = makeAnchorMock();
    const crank = new Crank(anchor, gatherer, {
      proofMaxAttempts: 2,
      proofBackoffMs: [0, 0],
    });
    crank.on("error", () => {});

    await crank.executeAction(baseSettleAction);

    expect(calls.count).to.equal(2);
    expect(crank.getStatus(18187298, 1)?.status).to.equal("failed");
  });
});
