import { expect } from "chai";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { AnchorClient, SettleProofArgs } from "../../src/clients/anchor-client";
import { loadConfig } from "../../src/config";
import { TxLineClient } from "../../src/clients/txline-client";
import { ProofGatherer, ProofData } from "../../src/settlement/proof-gatherer";
import fs from "fs";
import path from "path";

// GoalInWindow on-chain settlement (fixture 18187298, devnet).
// txodds stat-validation for statKey=1 (P1 GOALS, period H1):
//   seq=890  -> value=0  -> predicate false -> outcome=No, winner=2 (NO)
//   seq=997  -> value=0  -> predicate false -> outcome=No, winner=2 (NO)
//   seq=1075 -> value=1  -> predicate true  -> outcome=Yes, winner=1 (YES)
//   seq=1097 -> value=1  -> predicate true  -> outcome=Yes, winner=1 (YES)
const WALLETS_DIR = path.resolve(__dirname, "../../../kicktick/wallets");
const FIXTURE_ID = 18187298;
const LOCK = 15;
const DEADLINE = 20;
const BET = 0.01 * LAMPORTS_PER_SOL;
const STATKEY_P1_GOALS = 1;
const PERIOD_H1 = 0;

interface RoundSpec {
  label: string;
  seq: number;
  expectedOutcome: "Yes" | "No";
  expectedWinner: number;
}

const ROUND_SPECS: RoundSpec[] = [
  { label: "round 1 (seq=890,  No)",  seq: 890,  expectedOutcome: "No",  expectedWinner: 2 },
  { label: "round 2 (seq=1075, Yes)", seq: 1075, expectedOutcome: "Yes", expectedWinner: 1 },
  { label: "round 3 (seq=997,  No)",  seq: 997,  expectedOutcome: "No",  expectedWinner: 2 },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function loadWallet(i: number): Keypair {
  const raw = JSON.parse(
    fs.readFileSync(
      path.join(WALLETS_DIR, `wallet-${String(i).padStart(2, "0")}.json`),
      "utf-8",
    ),
  );
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function expectAnchorError(p: Promise<any>, fragment: string): Promise<void> {
  try {
    await p;
    throw new Error("expected error, got success");
  } catch (err: any) {
    if (!err.message?.includes(fragment)) throw err;
  }
}

describe("GoalInWindow × 3 rounds — devnet, fixture 18187298", function () {
  this.timeout(900_000);

  let client: AnchorClient;
  let connection: Connection;
  let matchPda: PublicKey;
  let vaultPda: PublicKey;
  let txline: TxLineClient;
  let gatherer: ProofGatherer;
  let wallets: Keypair[];
  let roundBase: number;

  before(async function () {
    const config = loadConfig();
    connection = new Connection(config.solanaRpcUrl, "confirmed");
    client = new AnchorClient(config);
    txline = new TxLineClient(config);
    await txline.authenticate().then((jwt) => txline.setJwt(jwt));
    gatherer = new ProofGatherer(txline);

    // Config PDA must exist (one-time init). init-kicktick.ts broken on
    // @solana/web3.js 1.95 ("sanitize accounts offsets"); relayer client works.
    const cfg = await client.fetchConfig().catch(() => null);
    if (!cfg) await client.initConfig();

    const [mpda] = AnchorClient.deriveMatchPda(FIXTURE_ID, client.programId);
    const existing = await connection.getAccountInfo(mpda);
    if (!existing) {
      const r = await client.initMatch(FIXTURE_ID, "Home FC", "Away United");
      matchPda = r.matchPda;
      vaultPda = r.vaultPda;
    } else {
      matchPda = mpda;
      const [vpda] = PublicKey.findProgramAddressSync(
        [Buffer.from("match_vault"), matchPda.toBuffer()],
        client.programId,
      );
      vaultPda = vpda;
    }

    const m = await client.fetchMatch(matchPda);
    roundBase = m.roundCounter.toNumber();

    wallets = [];
    for (let i = 1; i <= 6; i++) wallets.push(loadWallet(i));
    for (let i = 0; i < 6; i++) {
      const bal = await connection.getBalance(wallets[i].publicKey);
      if (bal < 0.05 * LAMPORTS_PER_SOL) {
        console.warn(
          `wallet-${String(i + 1).padStart(2, "0")} low: ${bal / LAMPORTS_PER_SOL} SOL`,
        );
      }
    }
  });

  for (const spec of ROUND_SPECS) {
    describe(spec.label, () => {
      const roundId = 0; // set in before; roundBase + offset below

      it("opens GoalInWindow round", async () => {
        const rid = roundBase + 1;
        await client.openRound(rid, "GoalInWindow", LOCK, DEADLINE, matchPda);
        const [rpda] = AnchorClient.deriveRoundPda(matchPda, rid, client.programId);
        const round = await client.fetchRound(rpda);
        expect(round.status.open).to.not.be.undefined;
        expect(round.settlementModel.onChain).to.not.be.undefined;
      });

      it("places 6 bets — 3 YES (wallets 1-3) + 3 NO (wallets 4-6) × 0.01 SOL", async () => {
        const rid = roundBase + 1;
        for (let i = 0; i < 3; i++) {
          await client.placeBet(FIXTURE_ID, rid, 0, BET, matchPda, wallets[i]);
          await sleep(400);
        }
        for (let i = 3; i < 6; i++) {
          await client.placeBet(FIXTURE_ID, rid, 1, BET, matchPda, wallets[i]);
          await sleep(400);
        }
        const [rpda] = AnchorClient.deriveRoundPda(matchPda, rid, client.programId);
        const round = await client.fetchRound(rpda);
        expect(round.totalYes.toNumber()).to.equal(3 * BET);
        expect(round.totalNo.toNumber()).to.equal(3 * BET);
      });

      it("settles onchain after deadline (gather proof + settleRound)", async () => {
        const rid = roundBase + 1;
        await sleep(DEADLINE * 1000 + 2000);

        const proof: ProofData = await gatherer.gatherProof(
          FIXTURE_ID,
          spec.seq,
          STATKEY_P1_GOALS,
          PERIOD_H1,
        );

        const proofArgs: SettleProofArgs = {
          ts: proof.ts,
          fixtureSummary: {
            fixtureId: proof.fixtureSummary.fixture_id,
            updateStats: {
              updateCount: proof.fixtureSummary.update_stats.update_count,
              minTimestamp: proof.fixtureSummary.update_stats.min_timestamp,
              maxTimestamp: proof.fixtureSummary.update_stats.max_timestamp,
            },
            eventsSubTreeRoot: proof.fixtureSummary.events_sub_tree_root,
          },
          fixtureProof: proof.fixtureProof.map((n) => ({ hash: n.hash, isRightSibling: n.is_right_sibling })),
          mainTreeProof: proof.mainTreeProof.map((n) => ({ hash: n.hash, isRightSibling: n.is_right_sibling })),
          predicate: { threshold: 0, comparison: "GreaterThan" },
          statA: {
            statToProve: {
              key: proof.statA.stat_to_prove.key,
              value: proof.statA.stat_to_prove.value,
              period: proof.statA.stat_to_prove.period,
            },
            eventStatRoot: proof.statA.event_stat_root,
            statProof: proof.statA.stat_proof.map((n) => ({ hash: n.hash, isRightSibling: n.is_right_sibling })),
          },
        };

        await client.settleRound(rid, matchPda, proofArgs);

        const [rpda] = AnchorClient.deriveRoundPda(matchPda, rid, client.programId);
        const round = await client.fetchRound(rpda);
        expect(round.status.resolvedPending).to.not.be.undefined;
        expect(round.winner).to.equal(spec.expectedWinner);
        if (spec.expectedOutcome === "Yes") {
          expect(round.outcome.yes).to.not.be.undefined;
        } else {
          expect(round.outcome.no).to.not.be.undefined;
        }
      });

      it("confirms round immediately", async () => {
        const rid = roundBase + 1;
        await client.confirmRound(rid, matchPda);
        const [rpda] = AnchorClient.deriveRoundPda(matchPda, rid, client.programId);
        const round = await client.fetchRound(rpda);
        expect(round.status.settled).to.not.be.undefined;
      });

      it("winners claim pro-rata, losers rejected", async () => {
        const rid = roundBase + 1;
        const winnerSide0 = spec.expectedWinner === 1; // YES side 0 wins, NO side 1 wins
        const totalPool = 6 * BET;
        const winningPool = 3 * BET;
        const expectedPayout = Math.floor((BET * totalPool) / winningPool);

        const winnerIdx = winnerSide0 ? [0, 1, 2] : [3, 4, 5];
        const loserIdx = winnerSide0 ? [3, 4, 5] : [0, 1, 2];

        for (const i of winnerIdx) {
          const before = await connection.getBalance(wallets[i].publicKey);
          await client.claimWinnings(FIXTURE_ID, rid, matchPda, wallets[i]);
          const after = await connection.getBalance(wallets[i].publicKey);
          const gain = after - before;
          expect(Math.abs(gain - expectedPayout)).to.be.lessThan(20000);
        }
        for (const i of loserIdx) {
          await expectAnchorError(
            client.claimWinnings(FIXTURE_ID, rid, matchPda, wallets[i]),
            "NotWinner",
          );
        }
      });

      it("bumps roundBase for next round", async () => {
        const m = await client.fetchMatch(matchPda);
        roundBase = m.roundCounter.toNumber();
      });
    });
  }

  it("vault near zero after all 3 rounds", async () => {
    const vaultBal = await connection.getBalance(vaultPda);
    expect(vaultBal).to.be.lessThan(2_000_000);
  });
});