import type { PublicKey } from "@solana/web3.js";

/** Durable representation of a Match account owned by the KickTick program. */
export interface MatchRecord {
  fixture_id: string;
  match: string;
  status: string;
  home_team: string;
  away_team: string;
  competition_id: number;
  created_at: number;
  updated_at: number;
  onchain_seen_at: number;
}

/** Fields decoded from the authoritative on-chain Match account. */
export interface OnChainMatch {
  fixtureId: number;
  matchPda: PublicKey;
  status: string;
  homeTeam: string;
  awayTeam: string;
  competitionId: number;
  createdAt: number;
}
