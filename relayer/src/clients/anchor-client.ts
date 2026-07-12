import {
  PublicKey,
  ComputeBudgetProgram,
  Transaction,
  SystemProgram,
  Keypair,
  Connection,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet, BN } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Idl } from "@anchor-lang/core/dist/cjs/idl";
import { Config } from "../config";
import { MarketType } from "../domain/markets";
import type { MarketOutcome, MarketRecord } from "../domain/markets";
import type { OnChainMatch } from "../domain/matches";
import type { Fill } from "../domain/settlement/types";
import type { StoredOrder } from "../clob/types";
import { u64ToLeBytes } from "../domain/ids";
import { solanaRpcFetch } from "./solana-rpc";

// ── IDL ──

const kicktickIdl: Idl = require("../idl/kicktick.json");

// ── Type definitions (mirroring Anchor program types for type-safety) ──

export { MarketType } from "../domain/markets";
export type { MarketOutcome } from "../domain/markets";

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

    const connection = new Connection(config.solanaRpcUrl, {
      commitment: "confirmed",
      fetch: solanaRpcFetch,
      disableRetryOnRateLimit: true,
    });

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

  static deriveConfigPda(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  }

  static deriveMatchPda(fixtureId: number, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("match"), u64ToLeBytes(fixtureId, "fixture id")], programId);
  }

  static deriveMarketPda(fixtureId: bigint, marketType: number, marketSeq: bigint, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([
      Buffer.from("market"), u64ToLeBytes(fixtureId, "fixture id"), Buffer.from([marketType]), u64ToLeBytes(marketSeq, "market sequence"),
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

  static deriveOrderPda(owner: PublicKey, nonce: bigint, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("order"), owner.toBuffer(), new BN(nonce.toString()).toArrayLike(Buffer, "le", 8)], programId);
  }

  static deriveDailyScoresRootsPda(txoracleProgramId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_merkle_roots")],
      txoracleProgramId,
    );
  }

  // ── Transaction helpers ──

  private async buildAndSend(ix: Promise<Transaction>): Promise<string>;
  private async buildAndSend(ix: Promise<Transaction>, cuLimit: number): Promise<string>;
  private async buildAndSend(ix: Promise<Transaction>, cuLimit: number, signers: Keypair[]): Promise<string>;
  private async buildAndSend(ix: Promise<Transaction>, cuLimit?: number, signers?: Keypair[]): Promise<string> {
    const startedAt = Date.now();
    console.log(`[ANCHOR_TX] build start cuLimit=${cuLimit ?? "default"} signerCount=${signers?.length ?? 0}`);
    let tx: Transaction;
    try {
      tx = await ix;
      console.log(`[ANCHOR_TX] build complete instructions=${tx.instructions.length} elapsedMs=${Date.now() - startedAt}`);
    } catch (err) {
      console.error('[ANCHOR_TX] build failed', err);
      throw new AnchorClientError(
        `Failed to build transaction: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (cuLimit && cuLimit > 0) {
      const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit });
      tx = new Transaction().add(cuIx).add(tx);
    }

    try {
      console.log(`[ANCHOR_TX] sendAndConfirm start feePayer=${this.walletPublicKey.toBase58()}`);
      const sig = await this.provider.sendAndConfirm(tx, signers);
      console.log(`[ANCHOR_TX] confirmed sig=${sig} elapsedMs=${Date.now() - startedAt}`);
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
      console.error(`[ANCHOR_TX] failed elapsedMs=${Date.now() - startedAt} message=${msg}`, logs ?? err);
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
    const [matchPda] = AnchorClient.deriveMatchPda(fixtureId, this.programId);
    await this.fetchMatchRecord(matchPda);
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
          baselineA: params.baselineA ?? 0,
          baselineB: params.baselineB ?? 0,
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

  async expireOrder(order: StoredOrder): Promise<string> {
    const owner = new PublicKey(order.owner);
    const market = new PublicKey(order.market);
    return this.buildAndSend((this.program.methods as any).expireOrder().accountsStrict({
      relayer: this.walletPublicKey,
      config: AnchorClient.deriveConfigPda(this.programId)[0],
      userAccount: AnchorClient.deriveUserAccountPda(owner, this.programId)[0],
      order: new PublicKey(order.order_pda),
      market,
      position: AnchorClient.derivePositionPda(market, owner, this.programId)[0],
    }).transaction());
  }

  async cancelOrderAfterLock(order: StoredOrder): Promise<string> {
    const owner = new PublicKey(order.owner);
    const market = new PublicKey(order.market);
    return this.buildAndSend((this.program.methods as any).cancelOrderAfterLock().accountsStrict({
      relayer: this.walletPublicKey,
      config: AnchorClient.deriveConfigPda(this.programId)[0],
      owner,
      userAccount: AnchorClient.deriveUserAccountPda(owner, this.programId)[0],
      order: new PublicKey(order.order_pda),
      market,
      position: AnchorClient.derivePositionPda(market, owner, this.programId)[0],
    }).transaction());
  }

  async orderExists(orderPda: string): Promise<boolean> {
    return (await this.provider.connection.getAccountInfo(new PublicKey(orderPda), "confirmed")) !== null;
  }

  async resolveMarketWithProof(marketAddress: string, proofArgs: SettleProofArgs): Promise<string> {
    const market = new PublicKey(marketAddress);
    const [dailyScoresRootsPda] = AnchorClient.deriveDailyScoresRootsPda(
      this.config.txoracleProgramId,
    );

    const args = {
      ts: new BN(proofArgs.ts),
      fixtureSummary: {
        fixtureId: new BN(proofArgs.fixtureSummary.fixtureId),
        updateStats: {
          updateCount: new BN(proofArgs.fixtureSummary.updateStats.updateCount),
          minTimestamp: new BN(proofArgs.fixtureSummary.updateStats.minTimestamp),
          maxTimestamp: new BN(proofArgs.fixtureSummary.updateStats.maxTimestamp),
        },
        eventsSubTreeRoot: proofArgs.fixtureSummary.eventsSubTreeRoot,
      },
      fixtureProof: proofArgs.fixtureProof.map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling })),
      mainTreeProof: proofArgs.mainTreeProof.map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling })),
      predicate: {
        threshold: new BN(proofArgs.predicate.threshold),
        comparison: { [camelCase(proofArgs.predicate.comparison)]: {} },
      },
      statA: {
        statToProve: {
          key: new BN(proofArgs.statA.statToProve.key),
          value: new BN(proofArgs.statA.statToProve.value),
          period: new BN(proofArgs.statA.statToProve.period),
        },
        eventStatRoot: proofArgs.statA.eventStatRoot,
        statProof: proofArgs.statA.statProof.map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling })),
      },
      statB: proofArgs.statB ? {
        statToProve: {
          key: new BN(proofArgs.statB.statToProve.key),
          value: new BN(proofArgs.statB.statToProve.value),
          period: new BN(proofArgs.statB.statToProve.period),
        },
        eventStatRoot: proofArgs.statB.eventStatRoot,
        statProof: proofArgs.statB.statProof.map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling })),
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

  async fetchConfig(): Promise<any> {
    const [configPda] = AnchorClient.deriveConfigPda(this.programId);
    return (this.program.account as Accounts).config.fetch(configPda);
  }

  async initMatch(
    fixtureId: number,
    homeTeam: string,
    awayTeam: string,
  ): Promise<{ sig: string; matchPda: PublicKey; vaultPda: PublicKey }> {
    console.log(`[ANCHOR_TX] initMatch fixture=${fixtureId} home="${homeTeam}" away="${awayTeam}"`);
    const [matchPda] = AnchorClient.deriveMatchPda(fixtureId, this.programId);
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("match_vault"), matchPda.toBuffer()],
      this.programId,
    );

    const initMatch = (this.program.methods as any).initMatch;
    if (typeof initMatch !== "function") {
      throw new AnchorClientError("initMatch is missing from the loaded Anchor IDL; rebuild the contract and relayer");
    }

    const sig = await this.buildAndSend(
      initMatch(new BN(fixtureId), homeTeam, awayTeam).accountsStrict({
        creator: this.walletPublicKey,
        config: AnchorClient.deriveConfigPda(this.programId)[0],
        matchPda,
        matchVault: vaultPda,
        systemProgram: SystemProgram.programId,
      }).transaction(),
    );

    return { sig, matchPda, vaultPda };
  }

  async fetchMatch(matchPda: PublicKey): Promise<any> {
    return (this.program.account as Accounts).match.fetch(matchPda);
  }

  private decodeMatch(matchPda: PublicKey, account: any): OnChainMatch {
    const status = typeof account.status === "string"
      ? account.status
      : Object.keys(account.status ?? {})[0] ?? "unknown";
    return {
      fixtureId: Number(account.fixtureId),
      matchPda,
      status: status.toUpperCase(),
      homeTeam: String(account.homeTeam ?? ""),
      awayTeam: String(account.awayTeam ?? ""),
      competitionId: Number(account.competitionId ?? 0),
      createdAt: Number(account.createdAt ?? 0),
    };
  }

  async fetchMatchRecord(matchPda: PublicKey): Promise<OnChainMatch> {
    return this.decodeMatch(matchPda, await this.fetchMatch(matchPda));
  }

  async listMatches(): Promise<OnChainMatch[]> {
    const accounts = await (this.program.account as any).match.all();
    return accounts.map((entry: { publicKey: PublicKey; account: any }) => this.decodeMatch(entry.publicKey, entry.account));
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
  async settleClobFill(fill: Fill, buyerOrderPda: string, sellerOrderPda: string): Promise<string> {
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
        buyerOrder: new PublicKey(buyerOrderPda),
        sellerAccount: AnchorClient.deriveUserAccountPda(seller, this.programId)[0], sellerVault: AnchorClient.deriveUserVaultPda(seller, this.programId)[0],
        sellerPosition: AnchorClient.derivePositionPda(market, seller, this.programId)[0],
        sellerOrder: new PublicKey(sellerOrderPda), systemProgram: SystemProgram.programId,
      }).transaction());
    }
    throw new AnchorClientError(`complete-set fill ${fill.id} must be submitted with owner expansion`);
  }

  async settleCompleteSetFill(fill: Fill, orders: StoredOrder[]): Promise<string> {
    const market = new PublicKey(fill.market);
    if (orders.length !== fill.prices_bps.length || (orders.length !== 2 && orders.length !== 3)) throw new AnchorClientError("complete-set fill order count does not match prices");
    if (orders.some((order, index) => order.outcome_index !== index)) throw new AnchorClientError("complete-set orders must be sorted by outcome index");
    const accounts = {
      relayer: this.walletPublicKey, config: AnchorClient.deriveConfigPda(this.programId)[0], market,
      marketVault: AnchorClient.deriveMarketVaultPda(market, this.programId)[0],
      collateralMint: this.config.usdtMint, tokenProgram: TOKEN_PROGRAM_ID,
    };
    const remainingAccounts = orders.flatMap(order => {
      const owner = new PublicKey(order.owner);
      return [
        { pubkey: AnchorClient.deriveUserAccountPda(owner, this.programId)[0], isSigner: false, isWritable: true },
        { pubkey: AnchorClient.deriveUserVaultPda(owner, this.programId)[0], isSigner: false, isWritable: true },
        { pubkey: new PublicKey(order.order_pda), isSigner: false, isWritable: true },
        { pubkey: AnchorClient.derivePositionPda(market, owner, this.programId)[0], isSigner: false, isWritable: true },
      ];
    });
    return this.buildAndSend((this.program.methods as any).settleCompleteSet(
      new BN(fill.market_sequence.toString()), fill.prices_bps, new BN(fill.quantity.toString()),
    ).accountsStrict(accounts).remainingAccounts(remainingAccounts).transaction());
  }

  async getNextFillSequence(market: string): Promise<bigint> {
    const account = await (this.program.account as any).market.fetch(new PublicKey(market));
    // `fillSequence` is part of the CLOB target account. The fallback keeps the
    // recovery layer usable against the in-progress migration IDL.
    return BigInt(account.fillSequence?.toString?.() ?? account.fill_sequence?.toString?.() ?? "0");
  }
}
