import { AnchorProvider, BN, Program, type Idl } from '@anchor-lang/core';
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import { deriveConfigPda, deriveMarketVaultPda, deriveOrderPda, derivePositionPda, deriveUserPda, deriveUserVaultPda } from './pdas';
import { createRpcConnection } from './rpc';

// Anchor/web3 still use the Node Buffer global while encoding instructions.
// Keep the polyfill local to the Solana client so browser transactions work
// even when the bundler does not inject globals for a dependency chunk.
if (!(globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
}

export interface KicktickNetworkConfig {
  rpcUrl: string;
  programId: string;
}

export const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const USDC_DECIMALS = 6;
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

function associatedTokenAddress(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), USDC_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function createAssociatedTokenAccountInstruction(payer: PublicKey, owner: PublicKey, ata: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array(0),
  });
}

export const KICKTICK_CONFIG: KicktickNetworkConfig = {
  rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  programId: import.meta.env.VITE_KICKTICK_PROGRAM_ID || 'LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND',
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
      config: deriveConfigPda(this.programId),
      collateralMint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).rpc();
  }

  async deposit(amount: bigint): Promise<string> {
    if (amount <= 0n) throw new Error('Deposit amount must be positive.');
    const program: any = await this.program();
    const source = associatedTokenAddress(this.wallet.publicKey);
    const instructions: TransactionInstruction[] = [];
    if (!(await this.connection.getAccountInfo(source, 'confirmed'))) {
      instructions.push(createAssociatedTokenAccountInstruction(this.wallet.publicKey, this.wallet.publicKey, source));
    }
    const transaction = await program.methods.deposit(new BN(amount.toString())).accounts({
      user: this.wallet.publicKey,
      userAccount: deriveUserPda(this.programId, this.wallet.publicKey),
      userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey),
      userSource: source,
      config: deriveConfigPda(this.programId),
      collateralMint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).transaction();
    transaction.instructions.unshift(...instructions);
    return (await program.provider.sendAndConfirm(transaction)) as string;
  }

  async withdraw(amount: bigint): Promise<string> {
    if (amount <= 0n) throw new Error('Withdrawal amount must be positive.');
    const program: any = await this.program();
    const destination = associatedTokenAddress(this.wallet.publicKey);
    const instructions: TransactionInstruction[] = [];
    if (!(await this.connection.getAccountInfo(destination, 'confirmed'))) {
      instructions.push(createAssociatedTokenAccountInstruction(this.wallet.publicKey, this.wallet.publicKey, destination));
    }
    const transaction = await program.methods.withdraw(new BN(amount.toString())).accounts({
      user: this.wallet.publicKey,
      userAccount: deriveUserPda(this.programId, this.wallet.publicKey),
      userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey),
      userDestination: destination,
      config: deriveConfigPda(this.programId),
      collateralMint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).transaction();
    transaction.instructions.unshift(...instructions);
    return (await program.provider.sendAndConfirm(transaction)) as string;
  }

  async createOrder(input: { market: string; side: 'BUY' | 'SELL'; outcomeIndex: number; priceBps: number; quantity: bigint | string; nonce: bigint; expiresAt: number }): Promise<{ signature: string; orderPda: PublicKey }> {
    const market = new PublicKey(input.market);
    const orderPda = deriveOrderPda(this.programId, this.wallet.publicKey, input.nonce);
    const program: any = await this.program();
    const signature = await program.methods.createOrder(
      input.side === 'BUY' ? { buy: {} } : { sell: {} }, input.outcomeIndex, input.priceBps,
      new BN(BigInt(input.quantity).toString()), new BN(input.nonce.toString()), new BN(input.expiresAt),
    ).accounts({ owner: this.wallet.publicKey, userAccount: deriveUserPda(this.programId, this.wallet.publicKey), market, order: orderPda, position: derivePositionPda(this.programId, market, this.wallet.publicKey), systemProgram: SystemProgram.programId }).rpc();
    return { signature, orderPda };
  }

  async split(marketAddress: string, amount: bigint): Promise<string> {
    if (amount <= 0n) throw new Error('Split amount must be positive.');
    const market = new PublicKey(marketAddress);
    const program: any = await this.program();
    return program.methods.split(new BN(amount.toString())).accounts({
      user: this.wallet.publicKey,
      userAccount: deriveUserPda(this.programId, this.wallet.publicKey),
      userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey),
      market,
      marketVault: deriveMarketVaultPda(this.programId, market),
      position: derivePositionPda(this.programId, market, this.wallet.publicKey),
      config: deriveConfigPda(this.programId),
      collateralMint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).rpc();
  }

  async merge(marketAddress: string, amount: bigint): Promise<string> {
    if (amount <= 0n) throw new Error('Merge amount must be positive.');
    const market = new PublicKey(marketAddress);
    const program: any = await this.program();
    return program.methods.merge(new BN(amount.toString())).accounts({
      user: this.wallet.publicKey,
      userAccount: deriveUserPda(this.programId, this.wallet.publicKey),
      userVault: deriveUserVaultPda(this.programId, this.wallet.publicKey),
      market,
      marketVault: deriveMarketVaultPda(this.programId, market),
      position: derivePositionPda(this.programId, market, this.wallet.publicKey),
      config: deriveConfigPda(this.programId),
      collateralMint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).rpc();
  }

  async cancelOrder(orderPda: string): Promise<string> {
    const order = new PublicKey(orderPda);
    const account: any = await ((await this.program()).account as any).orderAccount.fetch(order);
    const market = new PublicKey(account.market);
    const program: any = await this.program();
    return program.methods.cancelOrder().accounts({ owner: this.wallet.publicKey, userAccount: deriveUserPda(this.programId, this.wallet.publicKey), order, market, position: derivePositionPda(this.programId, market, this.wallet.publicKey) }).rpc();
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
      config: deriveConfigPda(this.programId),
      collateralMint: USDC_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
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

  async usdcBalance(owner: PublicKey): Promise<bigint> {
    const accounts = await this.connection.getParsedTokenAccountsByOwner(owner, { mint: USDC_MINT }, 'confirmed');
    return accounts.value.reduce((total, account) => {
      const amount = account.account.data.parsed?.info?.tokenAmount?.amount;
      return amount === undefined ? total : total + BigInt(amount);
    }, 0n);
  }

  private async tokenBalance(account: PublicKey): Promise<bigint> {
    try {
      const balance = await this.connection.getTokenAccountBalance(account, 'confirmed');
      return BigInt(balance.value.amount);
    } catch {
      return 0n;
    }
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
    const cacheKey = `${owner.toBase58()}:${market?.toBase58() ?? 'no-market'}`; const cached = this.userCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
    const userInfo = await this.connection.getAccountInfo(deriveUserPda(this.programId, owner));
    if (!userInfo) return undefined;
    const positionInfo = market ? await this.connection.getAccountInfo(derivePositionPda(this.programId, market, owner)) : undefined;
    const shares = [0n, 0n, 0n], lockedShares = [0n, 0n, 0n];
    if (positionInfo) for (let index = 0; index < 3; index++) { shares[index] = u64(positionInfo.data, 72 + index * 8); lockedShares[index] = u64(positionInfo.data, 96 + index * 8); }
    const vaultBalance = await this.tokenBalance(deriveUserVaultPda(this.programId, owner));
    const value = { owner: key(userInfo.data, 8), availableBalance: u64(userInfo.data, 40), reservedBalance: u64(userInfo.data, 48), vaultBalance, shares, lockedShares, claimed: positionInfo?.data[120] === 1 };
    this.userCache.set(cacheKey, { expires: Date.now() + 4_000, value }); return value;
  }
  clearUserCache(owner?: PublicKey): void {
    if (!owner) { this.userCache.clear(); return; }
    const prefix = `${owner.toBase58()}:`;
    for (const key of this.userCache.keys()) if (key.startsWith(prefix)) this.userCache.delete(key);
  }
}

export function usdcToBaseUnits(input: string): bigint {
  if (!/^\d*(?:\.\d{0,6})?$/.test(input) || Number(input) <= 0) throw new Error('Enter a positive USDC amount with up to 6 decimals.');
  const [whole = '0', fraction = ''] = input.split('.');
  return BigInt(`${whole || '0'}${fraction.padEnd(USDC_DECIMALS, '0')}`);
}

export function baseUnitsToUsdc(value: bigint | number | string): string {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(USDC_DECIMALS);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

// Kept for the non-trading legacy surface; /admin/trading uses the USDC helpers above.
export function solToLamports(input: string): bigint {
  if (!/^\d*(?:\.\d{0,9})?$/.test(input) || Number(input) <= 0) throw new Error('Enter a positive SOL amount with up to 9 decimals.');
  const [whole = '0', fraction = ''] = input.split('.');
  return BigInt(`${whole || '0'}${fraction.padEnd(9, '0')}`);
}

export function lamportsToSol(value: bigint | number | string): string {
  const amount = BigInt(value);
  const whole = amount / 1_000_000_000n;
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
