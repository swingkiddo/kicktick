import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { u64ToLeBytes } from "../../domain/ids";
import type { MarketType } from "../../domain/markets";

const MARKET_TYPES: readonly MarketType[] = [
  "NextGoalSide", "GoalInWindow", "NextCorner", "CornerInWindow",
  "NextYellowCard", "YellowCardInWindow", "RedCardInMatch",
  "PenaltyShootoutShot", "PenaltyShot", "VARCheck",
];

export class PdaFactory {
  constructor(readonly programId: PublicKey, readonly txoracleProgramId: PublicKey) {}

  marketTypeIndex(type: MarketType): number { return MARKET_TYPES.indexOf(type); }
  config(): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("config")], this.programId); }
  match(fixtureId: number): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("match"), u64ToLeBytes(fixtureId, "fixture id")], this.programId); }
  matchVault(match: PublicKey): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("match_vault"), match.toBuffer()], this.programId); }
  market(fixtureId: bigint, marketType: number, sequence: bigint): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("market"), u64ToLeBytes(fixtureId, "fixture id"), Buffer.from([marketType]), u64ToLeBytes(sequence, "market sequence")], this.programId);
  }
  marketVault(market: PublicKey): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("market_vault"), market.toBuffer()], this.programId); }
  userAccount(owner: PublicKey): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("user"), owner.toBuffer()], this.programId); }
  userVault(owner: PublicKey): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("user_vault"), owner.toBuffer()], this.programId); }
  position(market: PublicKey, owner: PublicKey): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), owner.toBuffer()], this.programId); }
  order(owner: PublicKey, nonce: bigint): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("order"), owner.toBuffer(), new BN(nonce.toString()).toArrayLike(Buffer, "le", 8)], this.programId); }
  dailyScoresRoots(): [PublicKey, number] { return PublicKey.findProgramAddressSync([Buffer.from("daily_scores_merkle_roots")], this.txoracleProgramId); }
}
