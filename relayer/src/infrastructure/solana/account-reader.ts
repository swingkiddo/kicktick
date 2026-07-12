import { PublicKey } from "@solana/web3.js";
import type { MarketRecord } from "../../domain/markets";
import type { OnChainMatch } from "../../domain/matches";
import { AnchorClientError } from "./errors";
import type { SolanaContext } from "./context";
import type { PdaFactory } from "./pda-factory";

export class AccountReader {
  constructor(private readonly context: SolanaContext, private readonly pdas: PdaFactory) {}
  async fetchConfig(): Promise<any> { return (this.context.program.account as any).config.fetch(this.pdas.config()[0]); }
  async fetchMatch(match: PublicKey): Promise<any> { return (this.context.program.account as any).match.fetch(match); }
  private decodeMatch(publicKey: PublicKey, account: any): OnChainMatch {
    const status = typeof account.status === "string" ? account.status : Object.keys(account.status ?? {})[0] ?? "unknown";
    return { fixtureId: Number(account.fixtureId), matchPda: publicKey, status: status.toUpperCase(), homeTeam: String(account.homeTeam ?? ""), awayTeam: String(account.awayTeam ?? ""), competitionId: Number(account.competitionId ?? 0), createdAt: Number(account.createdAt ?? 0) };
  }
  async fetchMatchRecord(match: PublicKey): Promise<OnChainMatch> { return this.decodeMatch(match, await this.fetchMatch(match)); }
  async listMatches(): Promise<OnChainMatch[]> {
    const accounts = await (this.context.program.account as any).match.all();
    return accounts.map((entry: any) => this.decodeMatch(entry.publicKey, entry.account));
  }
  async getMarketState(address: string): Promise<MarketRecord["state"]> {
    const account = await (this.context.program.account as any).market.fetch(new PublicKey(address));
    const variant = typeof account.status === "string" ? account.status : Object.keys(account.status ?? {})[0];
    const states: Record<string, MarketRecord["state"]> = { open: "OPEN", locked: "LOCKED", resolvedPending: "RESOLVED_PENDING", resolved: "RESOLVED", voided: "VOIDED" };
    const state = states[variant];
    if (!state) throw new AnchorClientError(`unknown on-chain market status ${String(variant)}`);
    return state;
  }
  async getMarketParams(address: string): Promise<{ period: number; baselineA: number; baselineB: number }> {
    const account = await (this.context.program.account as any).market.fetch(new PublicKey(address));
    return { period: Number(account.params.period), baselineA: Number(account.params.baselineA ?? account.params.baseline_a), baselineB: Number(account.params.baselineB ?? account.params.baseline_b) };
  }
  async getNextFillSequence(market: string): Promise<bigint> {
    const account = await (this.context.program.account as any).market.fetch(new PublicKey(market));
    return BigInt(account.fillSequence?.toString?.() ?? account.fill_sequence?.toString?.() ?? "0");
  }
  async orderExists(order: string): Promise<boolean> { return (await this.context.connection.getAccountInfo(new PublicKey(order), "confirmed")) !== null; }
}
