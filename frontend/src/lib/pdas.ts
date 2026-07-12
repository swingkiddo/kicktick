import { PublicKey } from '@solana/web3.js';

const utf8 = new TextEncoder();

export const SEEDS = {
  config: utf8.encode('config'),
  user: utf8.encode('user'),
  userVault: utf8.encode('user_vault'),
  market: utf8.encode('market'),
  marketVault: utf8.encode('market_vault'),
  position: utf8.encode('position'),
  order: utf8.encode('order'),
} as const;

function i64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

function u64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

export function deriveConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.config], programId)[0];
}

export function deriveUserPda(programId: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.user, owner.toBytes()], programId)[0];
}

export function deriveUserVaultPda(programId: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.userVault, owner.toBytes()], programId)[0];
}

export function deriveMarketPda(
  programId: PublicKey,
  fixtureId: bigint,
  marketTypeIndex: number,
  marketSeq: bigint,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.market, i64le(fixtureId), Uint8Array.of(marketTypeIndex), u64le(marketSeq)],
    programId,
  )[0];
}

export function deriveMarketVaultPda(programId: PublicKey, market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.marketVault, market.toBytes()], programId)[0];
}

export function derivePositionPda(programId: PublicKey, market: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.position, market.toBytes(), owner.toBytes()], programId)[0];
}

export function deriveOrderPda(programId: PublicKey, owner: PublicKey, nonce: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.order, owner.toBytes(), u64le(nonce)], programId)[0];
}
