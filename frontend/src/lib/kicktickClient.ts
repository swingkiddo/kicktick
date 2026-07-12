import { AnchorProvider, BN, Program, type Idl } from '@anchor-lang/core';
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import { deriveConfigPda, deriveMarketVaultPda, deriveOrderPda, derivePositionPda, deriveUserPda, deriveUserVaultPda } from './pdas';
import { createRpcConnection } from './rpc';

// Anchor's browser bundle still uses the Node Buffer global for instruction
// encoding. Vite does not inject Node globals automatically.
if (!(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

export interface KicktickNetworkConfig {
  rpcUrl: string;
  programId: string;
}

export const KICKTICK_CONFIG: KicktickNetworkConfig = {
  rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  programId: import.meta.env.VITE_KICKTICK_PROGRAM_ID || '7Pc2ipKnDya7UKhQVQA2zdateaLpgHGQbyNt34R5dNF4',
};

let idlPromise: Promise<Idl> | undefined;

async function loadIdl(): Promise<Idl> {
  idlPromise ??= fetch('/idl/kicktick.json', { cache: 'no-store' }).then(async (response) => {
    if (!response.ok) throw new Error('KickTick IDL is unavailable. Build contracts before the frontend.');
    return response.json() as Promise<Idl>;
  });
  return idlPromise;
}

export class KicktickClient {
  readonly connection: Connection;
  readonly programId: PublicKey;

  constructor(private readonly wallet: AnchorWallet, config = KICKTICK_CONFIG) {
    this.connection = createRpcConnection(config.rpcUrl, 'confirmed');
    this.programId = new PublicKey(config.programId);
  }

  private async program(): Promise<Program> {
    const idl = { ...(await loadIdl()), address: this.programId.toBase58() };
    return new Program(idl, new AnchorProvider(this.connection, this.wallet, { commitment: 'confirmed' }));
  }

  async walletBalance(): Promise<number> {
    return this.connection.getBalance(this.wallet.publicKey, 'confirmed');
  }

  async availableBalance(): Promise<bigint> {
    try {
      const account = await ((await this.program()).account as any).userAccount.fetch(deriveUserPda(this.programId, this.wallet.publicKey));
      return BigInt(account.availableBalance.toString());
    } catch {
      return 0n;
    }
  }

  async hasUserAccount(): Promise<boolean> {
    return (await this.connection.getAccountInfo(deriveUserPda(this.programId, this.wallet.publicKey), 'confirmed')) !== null;
  }

  async initUser(): Promise<string> {
    const program: any = await this.program();
    return program.methods.initUser().accounts({
      user: this.wallet.publicKey,
      userAccount: deriveUserPda(this.programId, this.wallet.publicKey),
      userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey),
      systemProgram: SystemProgram.programId,
    }).rpc();
  }

  async deposit(amountLamports: bigint): Promise<string> {
    if (amountLamports <= 0n) throw new Error('Deposit amount must be positive.');
    const program: any = await this.program();
    return program.methods.deposit(new BN(amountLamports.toString())).accounts({
      user: this.wallet.publicKey,
      userAccount: deriveUserPda(this.programId, this.wallet.publicKey),
      userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey),
      systemProgram: SystemProgram.programId,
    }).rpc();
  }

  async withdraw(amountLamports: bigint): Promise<string> {
    if (amountLamports <= 0n) throw new Error('Withdrawal amount must be positive.');
    const program: any = await this.program();
    return program.methods.withdraw(new BN(amountLamports.toString())).accounts({
      user: this.wallet.publicKey,
      userAccount: deriveUserPda(this.programId, this.wallet.publicKey),
      userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey),
      systemProgram: SystemProgram.programId,
    }).rpc();
  }

  async createOrder(input: { market: string; side: 'BUY' | 'SELL'; outcomeIndex: number; priceBps: number; quantity: bigint; nonce: bigint; expiresAt: number }): Promise<{ signature: string; orderPda: PublicKey }> {
    const market = new PublicKey(input.market);
    const orderPda = deriveOrderPda(this.programId, this.wallet.publicKey, input.nonce);
    const program: any = await this.program();
    const signature = await program.methods.createOrder(
      input.side === 'BUY' ? { buy: {} } : { sell: {} }, input.outcomeIndex, input.priceBps,
      new BN(input.quantity.toString()), new BN(input.nonce.toString()), new BN(input.expiresAt),
    ).accounts({ owner: this.wallet.publicKey, userAccount: deriveUserPda(this.programId, this.wallet.publicKey), userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey), market, order: orderPda, position: derivePositionPda(this.programId, market, this.wallet.publicKey), systemProgram: SystemProgram.programId }).rpc();
    return { signature, orderPda };
  }

  async cancelOrder(orderPda: string): Promise<string> {
    const order = new PublicKey(orderPda);
    const account: any = await ((await this.program()).account as any).orderAccount.fetch(order);
    const market = new PublicKey(account.market);
    const program: any = await this.program();
    return program.methods.cancelOrder().accounts({ owner: this.wallet.publicKey, userAccount: deriveUserPda(this.programId, this.wallet.publicKey), userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey), order, market, position: derivePositionPda(this.programId, market, this.wallet.publicKey), systemProgram: SystemProgram.programId }).rpc();
  }

  async claim(marketAddress: string): Promise<string> {
    const market = new PublicKey(marketAddress);
    const program: any = await this.program();
    return program.methods.claim().accounts({
      user: this.wallet.publicKey,
      userAccount: deriveUserPda(this.programId, this.wallet.publicKey),
      userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey),
      market,
      marketVault: deriveMarketVaultPda(this.programId, market),
      position: derivePositionPda(this.programId, market, this.wallet.publicKey),
      systemProgram: SystemProgram.programId,
    }).rpc();
  }
}

export interface ReadonlyConfig {
  admin: string; relayer: string; txoracleProgramId: string; minLiquidity: bigint; finalityDelay: bigint;
}
export interface ReadonlyMarket {
  address: string; fixtureId: bigint; marketType: number; marketSeq: bigint; status: number; winner?: number;
  expiresAt: bigint; outcomeCount: number; collateral: bigint; totalVolume: bigint; fillSequence: bigint; openPositions: bigint;
}
export interface ReadonlyUser {
  owner: string; availableBalance: bigint; reservedBalance: bigint; vaultBalance: bigint;
  shares: bigint[]; lockedShares: bigint[]; claimed: boolean;
}

function u64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}
function i64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}
function key(data: Uint8Array, offset: number): string { return new PublicKey(data.slice(offset, offset + 32)).toBase58(); }

/** RPC-only reader. It never creates an Anchor provider and cannot sign transactions. */
export class ReadonlyKicktickClient {
  readonly connection = createRpcConnection(KICKTICK_CONFIG.rpcUrl, 'confirmed');
  readonly programId = new PublicKey(KICKTICK_CONFIG.programId);
  private readonly userCache = new Map<string, { expires: number; value: ReadonlyUser }>();

  async walletBalance(owner: PublicKey): Promise<bigint> {
    return BigInt(await this.connection.getBalance(owner, 'confirmed'));
  }

  async config(): Promise<ReadonlyConfig | undefined> {
    const account = await this.connection.getAccountInfo(deriveConfigPda(this.programId));
    if (!account) return undefined;
    return { admin: key(account.data, 8), relayer: key(account.data, 40), txoracleProgramId: key(account.data, 72), finalityDelay: i64(account.data, 136), minLiquidity: u64(account.data, 144) };
  }

  async market(address: string): Promise<ReadonlyMarket | undefined> {
    const account = await this.connection.getAccountInfo(new PublicKey(address));
    if (!account || account.data.length < 98) return undefined;
    // Borsh encodes Option<u8> with a one-byte tag and only writes the value
    // byte when the option is Some. Do not use fixed offsets after winner.
    let offset = 8;
    const fixtureId = i64(account.data, offset); offset += 8;
    const marketType = account.data[offset]; offset += 1;
    const marketSeq = u64(account.data, offset); offset += 8;
    offset += 13; // MarketParams
    const outcomeCount = account.data[offset]; offset += 1;
    const status = account.data[offset]; offset += 1;
    const winnerTag = account.data[offset]; offset += 1;
    const winner = winnerTag ? account.data[offset++] : undefined;
    const expiresAt = i64(account.data, offset); offset += 8;
    offset += 8; // resolved_at
    offset += 2 * 3; // void_payout_bps
    const collateral = u64(account.data, offset); offset += 8;
    const totalVolume = u64(account.data, offset); offset += 8;
    const fillSequence = u64(account.data, offset); offset += 8;
    const openPositions = u64(account.data, offset);
    return { address, fixtureId, marketType, marketSeq, status, winner, expiresAt, outcomeCount, collateral, totalVolume, fillSequence, openPositions };
  }

  async user(owner: PublicKey, market?: PublicKey): Promise<ReadonlyUser | undefined> {
    const cacheKey = owner.toBase58(); const cached = this.userCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
    const userInfo = await this.connection.getAccountInfo(deriveUserPda(this.programId, owner));
    if (!userInfo) return undefined;
    const positionInfo = market ? await this.connection.getAccountInfo(derivePositionPda(this.programId, market, owner)) : undefined;
    const shares = [0n, 0n, 0n], lockedShares = [0n, 0n, 0n];
    if (positionInfo) for (let index = 0; index < 3; index++) { shares[index] = u64(positionInfo.data, 72 + index * 8); lockedShares[index] = u64(positionInfo.data, 96 + index * 8); }
    const value = { owner: key(userInfo.data, 8), availableBalance: u64(userInfo.data, 40), reservedBalance: u64(userInfo.data, 48), vaultBalance: BigInt(await this.connection.getBalance(deriveUserVaultPda(this.programId, owner), 'confirmed')), shares, lockedShares, claimed: positionInfo?.data[120] === 1 };
    this.userCache.set(cacheKey, { expires: Date.now() + 4_000, value }); return value;
  }
  clearUserCache(owner?: PublicKey): void { if (owner) this.userCache.delete(owner.toBase58()); else this.userCache.clear(); }
}

export function solToLamports(input: string): bigint {
  if (!/^\d*(?:\.\d{0,9})?$/.test(input) || Number(input) <= 0) throw new Error('Enter a positive SOL amount with up to 9 decimals.');
  const [whole = '0', fraction = ''] = input.split('.');
  return BigInt(`${whole || '0'}${fraction.padEnd(9, '0')}`);
}

export function lamportsToSol(lamports: bigint | number | string): string {
  const amount = BigInt(lamports);
  const whole = amount / 1_000_000_000n;
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
