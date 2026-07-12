import { PublicKey } from "@solana/web3.js";
import type { Config } from "../config";
import type { MarketType, MarketRecord } from "../domain/markets";
import type { OnChainMatch } from "../domain/matches";
import type { Fill } from "../domain/settlement/types";
import type { StoredOrder } from "../clob/types";
import { SolanaContext } from "../infrastructure/solana/context";
import { PdaFactory } from "../infrastructure/solana/pda-factory";
import { AccountReader } from "../infrastructure/solana/account-reader";
import { MarketGateway } from "../infrastructure/solana/market-gateway";
import { FillGateway } from "../infrastructure/solana/fill-gateway";

export { AnchorClientError } from "../infrastructure/solana/errors";
export type { SettleProofArgs, Comparison, BinaryExpression } from "../infrastructure/solana/type-mapper";
export { MarketType } from "../domain/markets";
export type { MarketOutcome } from "../domain/markets";
import type { SettleProofArgs } from "../infrastructure/solana/type-mapper";

/** Compatibility facade. New code should depend on the focused Solana services. */
export class AnchorClient {
  readonly context: SolanaContext;
  readonly pdas: PdaFactory;
  readonly accounts: AccountReader;
  readonly markets: MarketGateway;
  readonly fills: FillGateway;

  constructor(config: Config) {
    this.context = new SolanaContext(config);
    this.pdas = new PdaFactory(this.context.programId, config.txoracleProgramId);
    this.accounts = new AccountReader(this.context, this.pdas);
    this.markets = new MarketGateway(this.context, this.pdas, this.accounts);
    this.fills = new FillGateway(this.context, this.pdas);
  }

  get programId(): PublicKey { return this.context.programId; }
  get walletPublicKey(): PublicKey { return this.context.walletPublicKey; }

  static deriveConfigPda(programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).config(); }
  static deriveMatchPda(fixtureId: number, programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).match(fixtureId); }
  static deriveMarketPda(fixtureId: bigint, type: number, sequence: bigint, programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).market(fixtureId, type, sequence); }
  static deriveMarketVaultPda(market: PublicKey, programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).marketVault(market); }
  static deriveUserAccountPda(owner: PublicKey, programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).userAccount(owner); }
  static deriveUserVaultPda(owner: PublicKey, programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).userVault(owner); }
  static derivePositionPda(market: PublicKey, owner: PublicKey, programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).position(market, owner); }
  static deriveOrderPda(owner: PublicKey, nonce: bigint, programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).order(owner, nonce); }
  static deriveDailyScoresRootsPda(programId: PublicKey): [PublicKey, number] { return new PdaFactory(programId, programId).dailyScoresRoots(); }
  static marketTypeIndex(type: MarketType): number { return new PdaFactory(PublicKey.default, PublicKey.default).marketTypeIndex(type); }

  initConfig(): Promise<string> { return this.markets.initConfig(); }
  initMatch(fixtureId: number, home: string, away: string): Promise<{ sig: string; matchPda: PublicKey; vaultPda: PublicKey }> { return this.markets.initMatch(fixtureId, home, away); }
  initMarket(fixtureId: number, type: MarketType, sequence: number, deadline: number, params?: { participant?: number; period?: number; baselineA?: number; baselineB?: number }): Promise<string> { return this.markets.initMarket(fixtureId, type, sequence, deadline, params); }
  lockMarket(address: string): Promise<string> { return this.markets.lockMarket(address); }
  resolveMarketWithProof(address: string, proof: SettleProofArgs): Promise<string> { return this.markets.resolveMarketWithProof(address, proof); }
  resolveMarketOffchain(address: string, winner: number): Promise<string> { return this.markets.resolveMarketOffchain(address, winner); }
  confirmMarket(address: string): Promise<string> { return this.markets.confirmMarket(address); }
  fetchConfig(): Promise<any> { return this.accounts.fetchConfig(); }
  fetchMatch(address: PublicKey): Promise<any> { return this.accounts.fetchMatch(address); }
  fetchMatchRecord(address: PublicKey): Promise<OnChainMatch> { return this.accounts.fetchMatchRecord(address); }
  listMatches(): Promise<OnChainMatch[]> { return this.accounts.listMatches(); }
  getMarketState(address: string): Promise<MarketRecord["state"]> { return this.accounts.getMarketState(address); }
  getMarketParams(address: string): Promise<{ period: number; baselineA: number; baselineB: number }> { return this.accounts.getMarketParams(address); }
  getNextFillSequence(market: string): Promise<bigint> { return this.accounts.getNextFillSequence(market); }
  orderExists(order: string): Promise<boolean> { return this.accounts.orderExists(order); }
  expireOrder(order: StoredOrder): Promise<string> { return this.fills.expireOrder(order); }
  cancelOrderAfterLock(order: StoredOrder): Promise<string> { return this.fills.cancelOrderAfterLock(order); }
  settleClobFill(fill: Fill, buyerOrder: string, sellerOrder: string): Promise<string> { return this.fills.settleClobFill(fill, buyerOrder, sellerOrder); }
  settleCompleteSetFill(fill: Fill, orders: StoredOrder[]): Promise<string> { return this.fills.settleCompleteSetFill(fill, orders); }
}
