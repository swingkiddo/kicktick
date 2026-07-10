import { expect } from "chai";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { AnchorClient, MarketType } from "../../src/clients/anchor-client";
import { loadConfig } from "../../src/config";
import { MarketTrigger, TriggerAction } from "../../src/market/triggers";
import { Crank } from "../../src/settlement/crank";
import {
  SoccerAction,
  VarType,
  MarketType as EventMarketType,
} from "../../src/market/event-parser";
import type { MatchState } from "../../src/market/fixture-watcher";
import fs from "fs";
import path from "path";

const WALLETS_DIR = path.resolve(__dirname, "../../../kicktick/wallets");
const NOW = Date.now();
const FIX_A = 99001 + (NOW % 90000);
const FIX_B = 99002 + (NOW % 90000);
const BET = 0.01 * LAMPORTS_PER_SOL;
const LOCK = 15;
const DEADLINE = 120;
const VAULT_DRAINED = 10_000_000; // 0.01 SOL — accounts for rounding dust
const BETTOR_COUNT = 15;

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

function makeMatchState(
  fixtureId: number,
  matchPda: PublicKey,
): MatchState {
  return {
    fixtureId,
    matchPda,
    matchPdaBump: 255,
    status: 2 as any,
    currentPeriod: "H1",
    homeScore: 0,
    awayScore: 0,
    matchClockMs: 600_000,
    lastEventAt: Date.now(),
    roundCounter: 0,
    participants: { home: "Test Home", away: "Test Away" },
  };
}

function captureActions(trigger: MarketTrigger): { actions: TriggerAction[] } {
  const result = { actions: [] as TriggerAction[] };
  trigger.on("actions", (actions: TriggerAction[]) => {
    result.actions.push(...actions);
  });
  return result;
}

async function expectAnchorError(
  promise: Promise<any>,
  fragment: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected AnchorClientError but got success");
  } catch (err: any) {
    if (
      err.message &&
      (err.message.includes(fragment) ||
        err.message.includes("AnchorClientError"))
    ) {
      if (!err.message.includes(fragment)) throw err;
      return;
    }
    throw err;
  }
}

function forceRoundSettling(
  trigger: MarketTrigger,
  fixtureId: number,
  roundId: number,
): void {
  const f = (trigger as any).fixtures.get(fixtureId);
  if (!f) return;
  const round = f.rounds.get(roundId);
  if (round && round.status === "open") {
    round.status = "settling";
    round.settledAt = Date.now();
  }
}

describe("2-outcome (Yes/No) — devnet", function () {
  this.timeout(300_000);

  let client: AnchorClient;
  let connection: Connection;
  let trigger: MarketTrigger;
  let crank: Crank;
  let matchPda: PublicKey;
  let vaultPda: PublicKey;
  let matchState: MatchState;
  let wallets: Keypair[];
  let captured: { actions: TriggerAction[] };
  let roundOpenedAt: number;

  before(async function () {
    const config = loadConfig();
    connection = new Connection(config.solanaRpcUrl, "confirmed");
    client = new AnchorClient(config);

    const configExists = await client.fetchConfig().catch(() => null);
    if (!configExists) {
      await client.initConfig();
    }

    const result = await client.initMatch(FIX_A, "Test Home", "Test Away");
    matchPda = result.matchPda;
    vaultPda = result.vaultPda;

    wallets = [];
    for (let i = 1; i <= BETTOR_COUNT; i++) {
      wallets.push(loadWallet(i));
    }

    for (let i = 0; i < BETTOR_COUNT; i++) {
      const bal = await connection.getBalance(wallets[i].publicKey);
      if (bal < 0.015 * LAMPORTS_PER_SOL) {
        console.warn(
          `wallet-${String(i + 1).padStart(2, "0")} has ${bal / LAMPORTS_PER_SOL} SOL, need ≥0.015`,
        );
        this.skip();
        return;
      }
    }

    trigger = new MarketTrigger();
    crank = new Crank(client, null as any);
    matchState = makeMatchState(FIX_A, matchPda);
    captured = captureActions(trigger);
  });

  it("trigger pipeline: var event → open_round action", () => {
    const varEvent = {
      action: SoccerAction.Var,
      varType: VarType.Goal,
    };
    trigger.processEvent(varEvent as any, FIX_A, matchState);

    const openActions = captured.actions.filter(
      (a) => a.type === "open_round" && a.marketType === EventMarketType.VARCheck,
    );
    expect(openActions).to.have.length(1);
  });

  it("relayer opens VARCheck round on devnet via Crank", async () => {
    const openAction = captured.actions.find(
      (a) => a.type === "open_round" && a.marketType === EventMarketType.VARCheck,
    ) as TriggerAction & { type: "open_round" };
    expect(openAction).to.exist;
    console.log("DEBUG openAction:", JSON.stringify(openAction, null, 2));

    const customAction: TriggerAction = {
      ...openAction,
      lockSeconds: LOCK,
      deadlineSeconds: DEADLINE,
    };

    await crank.executeAction(customAction);
    roundOpenedAt = Date.now();

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, 1, client.programId);
    const round = await client.fetchRound(roundPda);

    expect(round.roundId.toNumber()).to.equal(1);
    expect(round.status.open).to.not.be.undefined;
    expect(round.settlementModel.offChain).to.not.be.undefined;
  });

  it("14 bettors place bets in time: 8 YES + 6 NO × 0.01 SOL", async () => {
    for (let i = 0; i < 8; i++) {
      await client.placeBet(FIX_A, 1, 0, BET, matchPda, wallets[i]);
      await sleep(500); // avoid devnet RPC rate limit
    }
    for (let i = 8; i < 14; i++) {
      await client.placeBet(FIX_A, 1, 1, BET, matchPda, wallets[i]);
      await sleep(500);
    }

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, 1, client.programId);
    const round = await client.fetchRound(roundPda);

    expect(round.totalYes.toNumber()).to.equal(8 * BET);
    expect(round.totalNo.toNumber()).to.equal(6 * BET);

    const vaultBal = await connection.getBalance(vaultPda);
    expect(vaultBal).to.be.at.least(14 * BET);
  });

  it("round still open before deadline", async () => {
    const elapsed = Date.now() - roundOpenedAt;
    const need = LOCK * 1000 - 2000 - elapsed;
    if (need > 0) await sleep(need);

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, 1, client.programId);
    const round = await client.fetchRound(roundPda);

    expect(round.status.open).to.not.be.undefined;
  });

  it("wallet-15 (index 14) late bet fails with DeadlinePassed", async () => {
    const elapsed = Date.now() - roundOpenedAt;
    const need = DEADLINE * 1000 + 2000 - elapsed;
    if (need > 0) await sleep(need);

    await expectAnchorError(
      client.placeBet(FIX_A, 1, 0, BET, matchPda, wallets[14]),
      "DeadlinePassed",
    );
  });

  it("relayer settles round on var_end event", async () => {
    const varEndEvent = {
      action: SoccerAction.VarEnd,
      outcome: "Overturned",
    };
    trigger.processEvent(varEndEvent as any, FIX_A, matchState);

    const settleActions = captured.actions.filter(
      (a) => a.type === "settle_offchain" && a.marketType === EventMarketType.VARCheck,
    );
    expect(settleActions).to.have.length(1);
    expect((settleActions[0] as any).outcome).to.equal("Yes");

    const settleAction = settleActions[0] as TriggerAction & { type: "settle_offchain" };
    await crank.executeAction(settleAction);

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, 1, client.programId);
    const round = await client.fetchRound(roundPda);

    expect(round.status.resolvedPending).to.not.be.undefined;
    expect(round.winner).to.equal(1);
    expect(round.outcome.yes).to.not.be.undefined;
  });

  it("relayer confirms round immediately after settle", async () => {
    forceRoundSettling(trigger, FIX_A, 1);
    const timeoutActions = trigger.checkTimeouts(FIX_A);

    const confirmAction = timeoutActions.find((a) => a.type === "confirm_round");
    expect(confirmAction).to.exist;

    await crank.executeAction(confirmAction!);

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, 1, client.programId);
    const round = await client.fetchRound(roundPda);

    expect(round.status.settled).to.not.be.undefined;
  });

  it("8 YES winners claim pro-rata (≈0.0175 SOL each)", async () => {
    const totalPool = 14 * BET;
    const winningPool = 8 * BET;
    const expectedPayout = Math.floor((BET * totalPool) / winningPool);

    for (let i = 0; i < 8; i++) {
      const before = await connection.getBalance(wallets[i].publicKey);
      await client.claimWinnings(FIX_A, 1, matchPda, wallets[i]);
      const after = await connection.getBalance(wallets[i].publicKey);

      const netGain = after - before;
      expect(Math.abs(netGain - expectedPayout)).to.be.lessThan(10000);
    }
  });

  it("6 NO bettors get NotWinner", async () => {
    for (let i = 8; i < 14; i++) {
      await expectAnchorError(
        client.claimWinnings(FIX_A, 1, matchPda, wallets[i]),
        "NotWinner",
      );
    }
  });

  it("late bettor (no position) gets AccountNotInitialized", async () => {
    await expectAnchorError(
      client.claimWinnings(FIX_A, 1, matchPda, wallets[14]),
      "AccountNotInitialized",
    );
  });

  it("vault balance is near zero after all claims", async () => {
    const vaultBal = await connection.getBalance(vaultPda);
    expect(vaultBal).to.be.lessThan(VAULT_DRAINED);
  });
});

describe("3-outcome (Home/Away/NoGoal) — devnet", function () {
  this.timeout(900_000);

  const BET3 = 0.01 * LAMPORTS_PER_SOL;

  let client: AnchorClient;
  let connection: Connection;
  let trigger: MarketTrigger;
  let crank: Crank;
  let matchPda: PublicKey;
  let vaultPda: PublicKey;
  let matchState: MatchState;
  let wallets: Keypair[];
  let captured: { actions: TriggerAction[] };

  before(async function () {
    const config = loadConfig();
    connection = new Connection(config.solanaRpcUrl, "confirmed");
    client = new AnchorClient(config);

    const configExists = await client.fetchConfig().catch(() => null);
    if (!configExists) {
      await client.initConfig();
    }

    const result = await client.initMatch(FIX_B, "Test Home", "Test Away");
    matchPda = result.matchPda;
    vaultPda = result.vaultPda;

    wallets = [];
    for (let i = 1; i <= BETTOR_COUNT; i++) {
      wallets.push(loadWallet(i));
    }

    for (let i = 0; i < BETTOR_COUNT; i++) {
      const bal = await connection.getBalance(wallets[i].publicKey);
      if (bal < 0.015 * LAMPORTS_PER_SOL) {
        console.warn(
          `wallet-${String(i + 1).padStart(2, "0")} has ${bal / LAMPORTS_PER_SOL} SOL, need ≥0.015`,
        );
        this.skip();
        return;
      }
    }

    trigger = new MarketTrigger();
    crank = new Crank(client, null as any);
    matchState = makeMatchState(FIX_B, matchPda);
    captured = captureActions(trigger);
  });

  function doOpenRound(roundId: number): void {
    const varEvent = { action: SoccerAction.Var, varType: VarType.Goal };
    trigger.processEvent(varEvent as any, FIX_B, matchState);
  }

  async function openAndBet(
    roundId: number,
    yesIndices: number[],
    noIndices: number[],
    abstainIndices: number[],
  ): Promise<void> {
    doOpenRound(roundId);

    const openAction = captured.actions.find(
      (a) =>
        a.type === "open_round" &&
        a.marketType === EventMarketType.VARCheck &&
        a.roundId === roundId,
    ) as TriggerAction & { type: "open_round" };
    expect(openAction).to.exist;

    const customAction: TriggerAction = {
      ...openAction,
      lockSeconds: LOCK,
      deadlineSeconds: DEADLINE,
    };

    await crank.executeAction(customAction);

    for (const i of yesIndices) {
      await client.placeBet(FIX_B, roundId, 0, BET3, matchPda, wallets[i]);
      await sleep(500);
    }
    for (const i of noIndices) {
      await client.placeBet(FIX_B, roundId, 1, BET3, matchPda, wallets[i]);
      await sleep(500);
    }
    for (const i of abstainIndices) {
      await client.placeBet(FIX_B, roundId, 2, BET3, matchPda, wallets[i]);
      await sleep(500);
    }
  }

  async function settleAndConfirm(
    roundId: number,
    outcome: "Home" | "Away" | "NoGoal",
    winner: number,
  ): Promise<void> {
    const need = DEADLINE * 1000 + 1000;
    await sleep(need);

    const settleAction: TriggerAction = {
      type: "settle_offchain",
      fixtureId: FIX_B,
      matchPda: matchPda.toBase58(),
      roundId,
      marketType: EventMarketType.VARCheck,
      outcome,
    };

    await crank.executeAction(settleAction);

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, roundId, client.programId);
    const round = await client.fetchRound(roundPda);

    expect(round.status.resolvedPending).to.not.be.undefined;
    expect(round.winner).to.equal(winner);

    forceRoundSettling(trigger, FIX_B, roundId);
    const timeoutActions = trigger.checkTimeouts(FIX_B);

    const confirmAction = timeoutActions.find(
      (a) => a.type === "confirm_round" && a.roundId === roundId,
    );
    expect(confirmAction).to.exist;

    await crank.executeAction(confirmAction!);

    const round2 = await client.fetchRound(roundPda);
    expect(round2.status.settled).to.not.be.undefined;
  }

  async function expectWinnerPayout(
    indices: number[],
    roundId: number,
    expectedPayout: number,
  ): Promise<void> {
    for (const i of indices) {
      const before = await connection.getBalance(wallets[i].publicKey);
      await client.claimWinnings(FIX_B, roundId, matchPda, wallets[i]);
      const after = await connection.getBalance(wallets[i].publicKey);
      const netGain = after - before;
      expect(Math.abs(netGain - expectedPayout)).to.be.lessThan(10000);
    }
  }

  async function expectNotWinner(
    indices: number[],
    roundId: number,
  ): Promise<void> {
    for (const i of indices) {
      await expectAnchorError(
        client.claimWinnings(FIX_B, roundId, matchPda, wallets[i]),
        "NotWinner",
      );
    }
  }

  it("round 1: open VARCheck + bet 5 YES + 5 NO + 5 ABSTAIN", async () => {
    const yesIdx = [0, 1, 2, 3, 4];
    const noIdx = [5, 6, 7, 8, 9];
    const abstainIdx = [10, 11, 12, 13, 14];

    await openAndBet(1, yesIdx, noIdx, abstainIdx);

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, 1, client.programId);
    const round = await client.fetchRound(roundPda);

    expect(round.totalYes.toNumber()).to.equal(5 * BET3);
    expect(round.totalNo.toNumber()).to.equal(5 * BET3);
    expect(round.totalAbstain.toNumber()).to.equal(5 * BET3);
    expect(round.status.open).to.not.be.undefined;
  });

  it("round 1: settle with outcome=Home + wait + confirm + 5 YES claim", async () => {
    const yesIdx = [0, 1, 2, 3, 4];
    const noIdx = [5, 6, 7, 8, 9];
    const abstainIdx = [10, 11, 12, 13, 14];

    await settleAndConfirm(1, "Home", 1);

    const totalPool = 15 * BET3;
    const winningPool = 5 * BET3;
    const expectedPayout = Math.floor((BET3 * totalPool) / winningPool);

    await expectWinnerPayout(yesIdx, 1, expectedPayout);
    await expectNotWinner([...noIdx, ...abstainIdx], 1);
  });

  it("round 2: open + bet (4 YES + 5 NO + 6 ABSTAIN) + settle outcome=Away + claims", async () => {
    const yesIdx = [0, 1, 2, 3];
    const noIdx = [4, 5, 6, 7, 8];
    const abstainIdx = [9, 10, 11, 12, 13, 14];

    await openAndBet(2, yesIdx, noIdx, abstainIdx);

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, 2, client.programId);
    const round = await client.fetchRound(roundPda);
    expect(round.totalYes.toNumber()).to.equal(4 * BET3);
    expect(round.totalNo.toNumber()).to.equal(5 * BET3);
    expect(round.totalAbstain.toNumber()).to.equal(6 * BET3);

    await settleAndConfirm(2, "Away", 2);

    const totalPool = 15 * BET3;
    const winningPool = 5 * BET3;
    const expectedPayout = Math.floor((BET3 * totalPool) / winningPool);

    await expectWinnerPayout(noIdx, 2, expectedPayout);
    await expectNotWinner([...yesIdx, ...abstainIdx], 2);
  });

  it("round 3: open + bet (5 YES + 4 NO + 6 ABSTAIN) + settle outcome=NoGoal + claims", async () => {
    const yesIdx = [0, 1, 2, 3, 4];
    const noIdx = [5, 6, 7, 8];
    const abstainIdx = [9, 10, 11, 12, 13, 14];

    await openAndBet(3, yesIdx, noIdx, abstainIdx);

    const [roundPda] = AnchorClient.deriveRoundPda(matchPda, 3, client.programId);
    const round = await client.fetchRound(roundPda);
    expect(round.totalYes.toNumber()).to.equal(5 * BET3);
    expect(round.totalNo.toNumber()).to.equal(4 * BET3);
    expect(round.totalAbstain.toNumber()).to.equal(6 * BET3);

    await settleAndConfirm(3, "NoGoal", 3);

    const totalPool = 15 * BET3;
    const winningPool = 6 * BET3;
    const expectedPayout = Math.floor((BET3 * totalPool) / winningPool);

    await expectWinnerPayout(abstainIdx, 3, expectedPayout);
    await expectNotWinner([...yesIdx, ...noIdx], 3);
  });

  it("vault drained after all 3 rounds", async () => {
    const vaultBal = await connection.getBalance(vaultPda);
    expect(vaultBal).to.be.lessThan(VAULT_DRAINED);
  });
});
