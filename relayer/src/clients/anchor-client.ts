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
import type { Fill, MarketRecord } from "../clob/types";

// ── IDL ──

const kicktickIdl: Idl = require("../idl/kicktick.json");

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

export type MarketOutcome =
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

const ENUM_VARIANTS: Record<string, string> = {
  // MarketType (mirrors anchor-client.ts MarketType union)
  NextGoalSide: "nextGoalSide",
  GoalInWindow: "goalInWindow",
  NextCorner: "nextCorner",
  CornerInWindow: "cornerInWindow",
  NextYellowCard: "nextYellowCard",
  YellowCardInWindow: "yellowCardInWindow",
  RedCardInMatch: "redCardInMatch",
  PenaltyShootoutShot: "penaltyShootoutShot",
  PenaltyShot: "penaltyShot",
  VARCheck: "varCheck",
  // Comparison
  GreaterThan: "greaterThan",
  LessThan: "lessThan",
  EqualTo: "equalTo",
  // BinaryExpression
  Add: "add",
  Subtract: "subtract",
  // MarketOutcome
  None: "none",
  Yes: "yes",
  No: "no",
  NoGoal: "noGoal",
  Home: "home",
  Away: "away",
  Cancelled: "cancelled",
};

function camelCase(s: string): string {
  return ENUM_VARIANTS[s] ?? s.charAt(0).toLowerCase() + s.slice(1);
}

function toLeBytes64(n: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n), 0);
  return buf;
}

// ── AnchorClient ──

// Account namespace shape — keys match Anchor 1.0 camelCase conversion
type Accounts = {
  config: { fetch(address: PublicKey): Promise<any> };
  match: { fetch(address: PublicKey): Promise<any> };
  position: { fetch(address: PublicKey): Promise<any> };
  sponsorVault: { fetch(address: PublicKey): Promise<any> };
};

export class AnchorClient {
  private program: Program;
  private provider: AnchorProvider;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // Override IDL address with configured program ID in case they differ
    const idl = { ...kicktickIdl, address: config.kicktickProgramId.toBase58() };

    // Load wallet from SOLANA_PRIVATE_KEY
    const keypair = Keypair.fromSecretKey(Buffer.from(config.solanaPrivateKey, "hex"));
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
    return PublicKey.findProgramAddressSync([Buffer.from("match"), toLeBytes64(fixtureId)], programId);
  }

  static deriveConfigPda(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  }

  static deriveMarketPda(fixtureId: bigint, marketType: number, marketSeq: bigint, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([
      Buffer.from("market"), toLeBytes64(Number(fixtureId)), Buffer.from([marketType]), toLeBytes64(Number(marketSeq)),
    ], programId);
  }

  static marketTypeIndex(marketType: MarketType): number {
    return [
      "NextGoalSide", "GoalInWindow", "NextCorner", "CornerInWindow",
      "NextYellowCard", "YellowCardInWindow", "RedCardInMatch",
      "PenaltyShootoutShot", "PenaltyShot", "VARCheck",
    ].indexOf(marketType);
  }

  static deriveMarketVaultPda(market: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("market_vault"), market.toBuffer()], programId);
  }

  static deriveUserAccountPda(owner: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("user"), owner.toBuffer()], programId);
  }

  static deriveUserVaultPda(owner: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("user_vault"), owner.toBuffer()], programId);
  }

  static derivePositionPda(market: PublicKey, owner: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), owner.toBuffer()], programId);
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
  private async buildAndSend(ix: Promise<Transaction>, cuLimit: number, signers: Keypair[]): Promise<string>;
  private async buildAndSend(ix: Promise<Transaction>, cuLimit?: number, signers?: Keypair[]): Promise<string> {
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
      const sig = await this.provider.sendAndConfirm(tx, signers);
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

  async initMarket(
    fixtureId: number,
    marketType: MarketType,
    marketSeq: number,
    deadlineSeconds: number,
    params: { participant?: number; period?: number; baselineA?: number; baselineB?: number } = {},
  ): Promise<string> {
    const typeIndex = AnchorClient.marketTypeIndex(marketType);
    if (typeIndex < 0) throw new AnchorClientError(`unknown market type ${marketType}`);
    const [market] = AnchorClient.deriveMarketPda(BigInt(fixtureId), typeIndex, BigInt(marketSeq), this.programId);
    const [marketVault] = AnchorClient.deriveMarketVaultPda(market, this.programId);
    return this.buildAndSend(
      (this.program.methods as any).initMarket(
        new BN(fixtureId),
        { [camelCase(marketType)]: {} },
        new BN(marketSeq),
        {
          participant: params.participant ?? 0,
          period: params.period ?? 0,
          baseline_a: params.baselineA ?? 0,
          baseline_b: params.baselineB ?? 0,
        },
        new BN(deadlineSeconds),
      ).accountsStrict({
        authority: this.walletPublicKey,
        config: AnchorClient.deriveConfigPda(this.programId)[0],
        market,
        marketVault,
        systemProgram: SystemProgram.programId,
      }).transaction(),
    );
  }

  async lockMarket(marketAddress: string): Promise<string> {
    const market = new PublicKey(marketAddress);
    return this.buildAndSend((this.program.methods as any).lockMarket().accountsStrict({
      authority: this.walletPublicKey,
      config: AnchorClient.deriveConfigPda(this.programId)[0],
      market,
    }).transaction());
  }

  async resolveMarketWithProof(marketAddress: string, proofArgs: SettleProofArgs): Promise<string> {
    const market = new PublicKey(marketAddress);
    const [dailyScoresRootsPda] = AnchorClient.deriveDailyScoresRootsPda(
      this.config.txoracleProgramId,
    );

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
      fixture_proof: proofArgs.fixtureProof.map((n) => ({ hash: n.hash, is_right_sibling: n.isRightSibling })),
      main_tree_proof: proofArgs.mainTreeProof.map((n) => ({ hash: n.hash, is_right_sibling: n.isRightSibling })),
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
        stat_proof: proofArgs.statA.statProof.map((n) => ({ hash: n.hash, is_right_sibling: n.isRightSibling })),
      },
      stat_b: proofArgs.statB ? {
        stat_to_prove: {
          key: new BN(proofArgs.statB.statToProve.key),
          value: new BN(proofArgs.statB.statToProve.value),
          period: new BN(proofArgs.statB.statToProve.period),
        },
        event_stat_root: proofArgs.statB.eventStatRoot,
        stat_proof: proofArgs.statB.statProof.map((n) => ({ hash: n.hash, is_right_sibling: n.isRightSibling })),
      } : null,
      op: proofArgs.op ? { [camelCase(proofArgs.op)]: {} } : null,
    };

    return this.buildAndSend(
      (this.program.methods as any).resolveMarketWithProof(args).accountsStrict({
        relayer: this.walletPublicKey,
        config: AnchorClient.deriveConfigPda(this.programId)[0],
        market,
        dailyScoresMerkleRoots: dailyScoresRootsPda,
        txoracleProgram: this.config.txoracleProgramId,
      }).transaction(),
      1_400_000,
    );
  }

  async resolveMarketOffchain(marketAddress: string, winner: number): Promise<string> {
    const market = new PublicKey(marketAddress);
    return this.buildAndSend((this.program.methods as any).resolveMarketOffchain(winner).accountsStrict({
      relayer: this.walletPublicKey,
      config: AnchorClient.deriveConfigPda(this.programId)[0],
      market,
    }).transaction());
  }

  async confirmMarket(marketAddress: string): Promise<string> {
    const market = new PublicKey(marketAddress);
    return this.buildAndSend((this.program.methods as any).confirmMarket().accountsStrict({
      config: AnchorClient.deriveConfigPda(this.programId)[0],
      market,
    }).transaction());
  }

  async initConfig(): Promise<string> {
    const [configPda] = AnchorClient.deriveConfigPda(this.programId);

    return this.buildAndSend(
      this.program.methods
        .initConfig()
        .accountsStrict({
          admin: this.walletPublicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .transaction(),
    );
  }

  async initMatch(
    fixtureId: number,
    homeTeam: string,
    awayTeam: string,
  ): Promise<{ sig: string; matchPda: PublicKey; vaultPda: PublicKey }> {
    const [matchPda] = AnchorClient.deriveMatchPda(fixtureId, this.programId);
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("match_vault"), matchPda.toBuffer()],
      this.programId,
    );

    const sig = await this.buildAndSend(
      this.program.methods
        .initMatch(new BN(fixtureId), homeTeam, awayTeam)
        .accountsStrict({
          creator: this.walletPublicKey,
          config: AnchorClient.deriveConfigPda(this.programId)[0],
          matchPda,
          matchVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .transaction(),
    );

    return { sig, matchPda, vaultPda };
  }

  async fetchMatch(matchPda: PublicKey): Promise<any> {
    return (this.program.account as Accounts).match.fetch(matchPda);
  }

  async fetchConfig(): Promise<any> {
    const [configPda] = AnchorClient.deriveConfigPda(this.programId);
    return (this.program.account as Accounts).config.fetch(configPda);
  }

  async getMarketState(marketAddress: string): Promise<MarketRecord["state"]> {
    const account = await (this.program.account as any).market.fetch(new PublicKey(marketAddress));
    const rawStatus = account.status;
    const variant = typeof rawStatus === "string" ? rawStatus : Object.keys(rawStatus ?? {})[0];
    const states: Record<string, MarketRecord["state"]> = {
      open: "OPEN", locked: "LOCKED", resolvedPending: "RESOLVED_PENDING",
      resolved: "RESOLVED", voided: "VOIDED",
    };
    const state = states[variant];
    if (!state) throw new AnchorClientError(`unknown on-chain market status ${String(variant)}`);
    return state;
  }

  async getMarketParams(marketAddress: string): Promise<{ period: number; baselineA: number; baselineB: number }> {
    const account = await (this.program.account as any).market.fetch(new PublicKey(marketAddress));
    const params = account.params;
    return {
      period: Number(params.period),
      baselineA: Number(params.baselineA ?? params.baseline_a),
      baselineB: Number(params.baselineB ?? params.baseline_b),
    };
  }

  /** CLOB settlement helpers. They intentionally use the generated IDL at runtime. */
  async settleClobFill(fill: Fill): Promise<string> {
    const market = new PublicKey(fill.market);
    if (fill.kind === "DIRECT") {
      if (!fill.buyer || !fill.seller || fill.outcome_index === undefined) throw new AnchorClientError("direct fill is missing buyer, seller, or outcome");
      const buyer = new PublicKey(fill.buyer), seller = new PublicKey(fill.seller);
      return this.buildAndSend((this.program.methods as any).settleShareTrade(
        new BN(fill.market_sequence.toString()), fill.outcome_index, fill.prices_bps[0], new BN(fill.quantity.toString()),
      ).accountsStrict({
        relayer: this.walletPublicKey, config: AnchorClient.deriveConfigPda(this.programId)[0], market,
        buyer, buyerAccount: AnchorClient.deriveUserAccountPda(buyer, this.programId)[0], buyerVault: AnchorClient.deriveUserVaultPda(buyer, this.programId)[0],
        buyerPosition: AnchorClient.derivePositionPda(market, buyer, this.programId)[0], seller,
        sellerAccount: AnchorClient.deriveUserAccountPda(seller, this.programId)[0], sellerVault: AnchorClient.deriveUserVaultPda(seller, this.programId)[0],
        sellerPosition: AnchorClient.derivePositionPda(market, seller, this.programId)[0], systemProgram: SystemProgram.programId,
      }).transaction());
    }
    throw new AnchorClientError(`complete-set fill ${fill.id} must be submitted with owner expansion`);
  }

  async settleCompleteSetFill(fill: Fill, owners: string[]): Promise<string> {
    const market = new PublicKey(fill.market);
    if (owners.length !== fill.prices_bps.length || (owners.length !== 2 && owners.length !== 3)) throw new AnchorClientError("complete-set fill owner count does not match prices");
    const accounts: Record<string, PublicKey> = {
      relayer: this.walletPublicKey, config: AnchorClient.deriveConfigPda(this.programId)[0], market,
      marketVault: AnchorClient.deriveMarketVaultPda(market, this.programId)[0], systemProgram: SystemProgram.programId,
    };
    owners.forEach((ownerString, index) => {
      const owner = new PublicKey(ownerString);
      accounts[`outcome${index}Owner`] = owner;
      accounts[`outcome${index}Account`] = AnchorClient.deriveUserAccountPda(owner, this.programId)[0];
      accounts[`outcome${index}Vault`] = AnchorClient.deriveUserVaultPda(owner, this.programId)[0];
      accounts[`outcome${index}Position`] = AnchorClient.derivePositionPda(market, owner, this.programId)[0];
    });
    const methods: any = this.program.methods;
    const method = owners.length === 2
      ? methods.settleCompleteSetBinary(new BN(fill.market_sequence.toString()), fill.prices_bps[0], fill.prices_bps[1], new BN(fill.quantity.toString()))
      : methods.settleCompleteSetTernary(new BN(fill.market_sequence.toString()), fill.prices_bps[0], fill.prices_bps[1], fill.prices_bps[2], new BN(fill.quantity.toString()));
    return this.buildAndSend(method.accountsStrict(accounts).transaction());
  }

  async getNextFillSequence(market: string): Promise<bigint> {
    const account = await (this.program.account as any).market.fetch(new PublicKey(market));
    // `fillSequence` is part of the CLOB target account. The fallback keeps the
    // recovery layer usable against the in-progress migration IDL.
    return BigInt(account.fillSequence?.toString?.() ?? account.fill_sequence?.toString?.() ?? "0");
  }
}
