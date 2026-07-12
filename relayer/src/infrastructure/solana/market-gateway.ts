import { BN } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { MarketType } from "../../domain/markets";
import type { SolanaContext } from "./context";
import type { PdaFactory } from "./pda-factory";
import type { AccountReader } from "./account-reader";
import { AnchorClientError } from "./errors";
import { anchorVariant, mapSettleProofArgs, type SettleProofArgs } from "./type-mapper";

export class MarketGateway {
  constructor(private readonly context: SolanaContext, private readonly pdas: PdaFactory, private readonly accounts: AccountReader) {}
  async initConfig(): Promise<string> { return this.context.send(this.context.program.methods.initConfig().accountsStrict({ admin: this.context.walletPublicKey, config: this.pdas.config()[0], systemProgram: SystemProgram.programId }).transaction()); }
  async initMatch(fixtureId: number, homeTeam: string, awayTeam: string): Promise<{ sig: string; matchPda: PublicKey; vaultPda: PublicKey }> {
    const matchPda = this.pdas.match(fixtureId)[0], vaultPda = this.pdas.matchVault(matchPda)[0];
    const method = (this.context.program.methods as any).initMatch;
    if (typeof method !== "function") throw new AnchorClientError("initMatch is missing from the loaded Anchor IDL; rebuild the contract and relayer");
    const sig = await this.context.send(method(new BN(fixtureId), homeTeam, awayTeam).accountsStrict({ creator: this.context.walletPublicKey, config: this.pdas.config()[0], matchPda, matchVault: vaultPda, systemProgram: SystemProgram.programId }).transaction());
    return { sig, matchPda, vaultPda };
  }
  async initMarket(fixtureId: number, type: MarketType, sequence: number, deadline: number, params: { participant?: number; period?: number; baselineA?: number; baselineB?: number } = {}): Promise<string> {
    const index = this.pdas.marketTypeIndex(type);
    if (index < 0) throw new AnchorClientError(`unknown market type ${type}`);
    await this.accounts.fetchMatchRecord(this.pdas.match(fixtureId)[0]);
    const market = this.pdas.market(BigInt(fixtureId), index, BigInt(sequence))[0];
    return this.context.send((this.context.program.methods as any).initMarket(new BN(fixtureId), { [anchorVariant(type)]: {} }, new BN(sequence), { participant: params.participant ?? 0, period: params.period ?? 0, baselineA: params.baselineA ?? 0, baselineB: params.baselineB ?? 0 }, new BN(deadline)).accountsStrict({ authority: this.context.walletPublicKey, config: this.pdas.config()[0], market, marketVault: this.pdas.marketVault(market)[0], collateralMint: this.context.config.collateralMint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).transaction());
  }
  async lockMarket(address: string): Promise<string> { return this.context.send((this.context.program.methods as any).lockMarket().accountsStrict({ authority: this.context.walletPublicKey, config: this.pdas.config()[0], market: new PublicKey(address) }).transaction()); }
  async resolveMarketWithProof(address: string, proof: SettleProofArgs): Promise<string> { return this.context.send((this.context.program.methods as any).resolveMarketWithProof(mapSettleProofArgs(proof)).accountsStrict({ relayer: this.context.walletPublicKey, config: this.pdas.config()[0], market: new PublicKey(address), dailyScoresMerkleRoots: this.pdas.dailyScoresRoots()[0], txoracleProgram: this.context.config.txoracleProgramId }).transaction(), 1_400_000); }
  async resolveMarketOffchain(address: string, winner: number): Promise<string> { return this.context.send((this.context.program.methods as any).resolveMarketOffchain(winner).accountsStrict({ relayer: this.context.walletPublicKey, config: this.pdas.config()[0], market: new PublicKey(address) }).transaction()); }
  async confirmMarket(address: string): Promise<string> { return this.context.send((this.context.program.methods as any).confirmMarket().accountsStrict({ config: this.pdas.config()[0], market: new PublicKey(address) }).transaction()); }
}
