import fs from "fs";
import {
  PublicKey,
  ComputeBudgetProgram,
  Transaction,
  SystemProgram,
  Keypair,
  Connection,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@anchor-lang/core";
import type { Idl } from "@anchor-lang/core/dist/cjs/idl";
import { Config } from "../config";
import { FixtureWatcher } from "../market/fixture-watcher";

// ── IDL ──

const kicktickIdl: Idl = require("../../../kicktick/target/idl/kicktick.json");

// ── Type definitions (mirroring Anchor program types for type-safety) ──

export type MarketType =
  | "NextGoalSide"
  | "GoalInWindow"
  | "NextCorner"
  | "CornerInWindow"
  | "NextYellowCard"
  | "YellowCardInWindow"
  | "RedCardInMatch"
  | "PenaltyShootoutShot"
  | "PenaltyShot"
  | "VARCheck";

export type RoundOutcome =
  | "None"
  | "Yes"
  | "No"
  | "NoGoal"
  | "Home"
  | "Away"
  | "Cancelled";

export type Comparison = "GreaterThan" | "LessThan" | "EqualTo";
export type BinaryExpression = "Add" | "Subtract";

export interface ProofNode {
  hash: number[];
  is_right_sibling: boolean;
}

export interface ScoreStat {
  key: number;
  value: number;
  period: number;
}

export interface StatTerm {
  stat_to_prove: ScoreStat;
  event_stat_root: number[];
  stat_proof: ProofNode[];
}

export interface ScoresUpdateStats {
  update_count: number;
  min_timestamp: number;
  max_timestamp: number;
}

export interface ScoresBatchSummary {
  fixture_id: number;
  update_stats: ScoresUpdateStats;
  events_sub_tree_root: number[];
}

export interface TraderPredicate {
  threshold: number;
  comparison: Comparison;
}

export interface ValidateStatArgs {
  ts: number;
  fixture_summary: ScoresBatchSummary;
  fixture_proof: ProofNode[];
  main_tree_proof: ProofNode[];
  predicate: TraderPredicate;
  stat_a: StatTerm;
  stat_b: StatTerm | null;
  op: BinaryExpression | null;
}

// ── User-facing proof args (flexible input types) ──

export interface SettleProofArgs {
  ts: number;
  fixtureSummary: {
    fixtureId: number;
    updateStats: {
      updateCount: number;
      minTimestamp: number;
      maxTimestamp: number;
    };
    eventsSubTreeRoot: number[];
  };
  fixtureProof: { hash: number[]; isRightSibling: boolean }[];
  mainTreeProof: { hash: number[]; isRightSibling: boolean }[];
  predicate: { threshold: number; comparison: "GreaterThan" | "LessThan" | "EqualTo" };
  statA: {
    statToProve: { key: number; value: number; period: number };
    eventStatRoot: number[];
    statProof: { hash: number[]; isRightSibling: boolean }[];
  };
  statB?: {
    statToProve: { key: number; value: number; period: number };
    eventStatRoot: number[];
    statProof: { hash: number[]; isRightSibling: boolean }[];
  };
  op?: "Add" | "Subtract";
}

// ── Anchor client error ──

export class AnchorClientError extends Error {
  constructor(
    message: string,
    public readonly logs?: string[],
  ) {
    super(message);
    this.name = "AnchorClientError";
  }
}

// ── Helper: expand ~ to home dir ──

function expandHome(filePath: string): string {
  if (filePath.startsWith("~")) {
    return filePath.replace("~", process.env.HOME || process.env.USERPROFILE || "");
  }
  return filePath;
}

function camelCase(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// ── AnchorClient ──

export class AnchorClient {
  private program: Program;
  private provider: AnchorProvider;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // Override IDL address with configured program ID in case they differ
    const idl = { ...kicktickIdl, address: config.kicktickProgramId.toBase58() };

    // Load wallet from keypair file
    const keypairPath = expandHome(config.solanaKeypairPath);
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    const wallet = new Wallet(keypair);

    const connection = new Connection(config.solanaRpcUrl, "confirmed");

    this.provider = new AnchorProvider(
      connection,
      wallet,
      { commitment: "confirmed", preflightCommitment: "confirmed" },
    );

    this.program = new Program(idl, this.provider);
  }

  get programId(): PublicKey {
    return this.program.programId;
  }

  get walletPublicKey(): PublicKey {
    return this.provider.wallet.publicKey;
  }

  // ── PDA derivation helpers ──

  static deriveMatchPda(fixtureId: number, programId: PublicKey): [PublicKey, number] {
    return FixtureWatcher.deriveMatchPda(fixtureId, programId);
  }

  static deriveRoundPda(
    matchPda: PublicKey,
    roundId: number,
    programId: PublicKey,
  ): [PublicKey, number] {
    return FixtureWatcher.deriveRoundPda(matchPda, roundId, programId);
  }

  static deriveConfigPda(programId: PublicKey): [PublicKey, number] {
    return FixtureWatcher.deriveConfigPda(programId);
  }

  static deriveDailyScoresRootsPda(txoracleProgramId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots")],
      txoracleProgramId,
    );
  }

  // ── Transaction helpers ──

  private async buildAndSend(ix: Promise<Transaction>): Promise<string>;
  private async buildAndSend(ix: Promise<Transaction>, cuLimit: number): Promise<string>;
  private async buildAndSend(ix: Promise<Transaction>, cuLimit?: number): Promise<string> {
    let tx: Transaction;
    try {
      tx = await ix;
    } catch (err) {
      throw new AnchorClientError(
        `Failed to build transaction: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (cuLimit && cuLimit > 0) {
      const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit });
      tx = new Transaction().add(cuIx).add(tx);
    }

    try {
      const sig = await this.provider.sendAndConfirm(tx);
      return sig;
    } catch (err: any) {
      const logs = err?.logs as string[] | undefined;
      let msg = `Transaction failed: ${err instanceof Error ? err.message : String(err)}`;
      if (logs && logs.length > 0) {
        const anchorErr = logs.find(
          (l) => l.includes("Error Code:") || l.includes("failed"),
        );
        if (anchorErr) msg = anchorErr;
      }
      throw new AnchorClientError(msg, logs);
    }
  }

  // ── Instruction builders ──

  async openRound(
    roundId: number,
    marketType: MarketType,
    lockSeconds: number,
    deadlineSeconds: number,
    matchPda: PublicKey,
  ): Promise<string> {
    const [roundPda] = AnchorClient.deriveRoundPda(
      matchPda,
      roundId,
      this.programId,
    );

    return this.buildAndSend(
      this.program.methods
        .openRound(
          new BN(roundId),
          { [marketType]: {} },
          new BN(lockSeconds),
          new BN(deadlineSeconds),
        )
        .accounts({
          authority: this.walletPublicKey,
          matchPda,
          round: roundPda,
          systemProgram: SystemProgram.programId,
        })
        .transaction(),
    );
  }

  async settleRound(
    roundId: number,
    matchPda: PublicKey,
    proofArgs: SettleProofArgs,
  ): Promise<string> {
    const [roundPda] = AnchorClient.deriveRoundPda(
      matchPda,
      roundId,
      this.programId,
    );
    const [dailyScoresRootsPda] = AnchorClient.deriveDailyScoresRootsPda(
      this.config.txoracleProgramId,
    );

    // Build ValidateStatArgs struct for Anchor encoding
    const args = {
      ts: new BN(proofArgs.ts),
      fixture_summary: {
        fixture_id: new BN(proofArgs.fixtureSummary.fixtureId),
        update_stats: {
          update_count: new BN(proofArgs.fixtureSummary.updateStats.updateCount),
          min_timestamp: new BN(proofArgs.fixtureSummary.updateStats.minTimestamp),
          max_timestamp: new BN(proofArgs.fixtureSummary.updateStats.maxTimestamp),
        },
        events_sub_tree_root: proofArgs.fixtureSummary.eventsSubTreeRoot,
      },
      fixture_proof: proofArgs.fixtureProof.map((n) => ({
        hash: n.hash,
        is_right_sibling: n.isRightSibling,
      })),
      main_tree_proof: proofArgs.mainTreeProof.map((n) => ({
        hash: n.hash,
        is_right_sibling: n.isRightSibling,
      })),
      predicate: {
        threshold: new BN(proofArgs.predicate.threshold),
        comparison: { [camelCase(proofArgs.predicate.comparison)]: {} },
      },
      stat_a: {
        stat_to_prove: {
          key: new BN(proofArgs.statA.statToProve.key),
          value: new BN(proofArgs.statA.statToProve.value),
          period: new BN(proofArgs.statA.statToProve.period),
        },
        event_stat_root: proofArgs.statA.eventStatRoot,
        stat_proof: proofArgs.statA.statProof.map((n) => ({
          hash: n.hash,
          is_right_sibling: n.isRightSibling,
        })),
      },
      stat_b: proofArgs.statB
        ? {
            stat_to_prove: {
              key: new BN(proofArgs.statB.statToProve.key),
              value: new BN(proofArgs.statB.statToProve.value),
              period: new BN(proofArgs.statB.statToProve.period),
            },
            event_stat_root: proofArgs.statB.eventStatRoot,
            stat_proof: proofArgs.statB.statProof.map((n) => ({
              hash: n.hash,
              is_right_sibling: n.isRightSibling,
            })),
          }
        : null,
      op: proofArgs.op ? { [camelCase(proofArgs.op)]: {} } : null,
    };

    return this.buildAndSend(
      this.program.methods
        .settleRound(args)
        .accounts({
          caller: this.walletPublicKey,
          matchPda,
          round: roundPda,
          dailyScoresMerkleRoots: dailyScoresRootsPda,
          txoracleProgram: this.config.txoracleProgramId,
        })
        .transaction(),
      1_400_000,
    );
  }

  async settleOffchainRound(
    roundId: number,
    matchPda: PublicKey,
    outcome: "Yes" | "No",
    winner: number,
  ): Promise<string> {
    const [roundPda] = AnchorClient.deriveRoundPda(
      matchPda,
      roundId,
      this.programId,
    );

    return this.buildAndSend(
      this.program.methods
        .settleOffchainRound({ [outcome]: {} }, new BN(winner))
        .accounts({
          caller: this.walletPublicKey,
          matchPda,
          round: roundPda,
        })
        .transaction(),
    );
  }

  async confirmRound(
    roundId: number,
    matchPda: PublicKey,
  ): Promise<string> {
    const [roundPda] = AnchorClient.deriveRoundPda(
      matchPda,
      roundId,
      this.programId,
    );

    return this.buildAndSend(
      this.program.methods
        .confirmRound()
        .accounts({
          caller: this.walletPublicKey,
          matchPda,
          round: roundPda,
        })
        .transaction(),
    );
  }

  async cancelRound(
    roundId: number,
    matchPda: PublicKey,
  ): Promise<string> {
    const [roundPda] = AnchorClient.deriveRoundPda(
      matchPda,
      roundId,
      this.programId,
    );
    const [configPda] = AnchorClient.deriveConfigPda(this.programId);

    return this.buildAndSend(
      this.program.methods
        .cancelRound()
        .accounts({
          caller: this.walletPublicKey,
          config: configPda,
          matchPda,
          round: roundPda,
        })
        .transaction(),
    );
  }
}
