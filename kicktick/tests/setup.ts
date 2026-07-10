/**
 * Shared test setup — starts solana-test-validator, deploys the KickTick
 * program, and exports helpers/constants for all test files.
 *
 * Loaded once by mocha via --file tests/setup.ts before any test modules.
 * Test files must `await setupReady` in a `before()` hook before accessing
 * provider / program / configPda.
 */

import * as anchor from '@anchor-lang/core';
import { Program } from '@anchor-lang/core';
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  Connection,
} from '@solana/web3.js';
import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { Kicktick } from '../target/types/kicktick';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCALNET_URL = 'http://127.0.0.1:8899';

const TXORACLE_PROGRAM_ID = new PublicKey(
  '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J',
);

const DAILY_SCORES_MERKLE_ROOTS = PublicKey.findProgramAddressSync(
  [Buffer.from('daily_scores_merkle_roots')],
  TXORACLE_PROGRAM_ID,
)[0];

const MARKET_TYPE: Record<string, number> = {
  NextGoalSide: 0,
  GoalInWindow: 1,
  NextCorner: 2,
  CornerInWindow: 3,
  NextYellowCard: 4,
  YellowCardInWindow: 5,
  RedCardInMatch: 6,
  PenaltyShootoutShot: 7,
  PenaltyShot: 8,
  VARCheck: 9,
};

const MIN_DURATION = 15;
const MAX_DURATION = 300;

// ---------------------------------------------------------------------------
// Helpers (pure, no state)
// ---------------------------------------------------------------------------

function findConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    programId,
  )[0];
}

function findUserPda(user: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user'), user.toBuffer()],
    programId,
  )[0];
}

function findUserVaultPda(user: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_vault'), user.toBuffer()],
    programId,
  )[0];
}

function findMarketPda(
  fixtureId: anchor.BN,
  marketType: number,
  marketSeq: anchor.BN,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('market'),
      Buffer.from(fixtureId.toArrayLike(Buffer, 'le', 8)),
      Buffer.from([marketType]),
      Buffer.from(marketSeq.toArrayLike(Buffer, 'le', 8)),
    ],
    programId,
  )[0];
}

function findMarketVaultPda(
  market: PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market_vault'), market.toBuffer()],
    programId,
  )[0];
}

function findPositionPda(
  market: PublicKey,
  owner: PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('position'), market.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

function loadWallet(name: string): Keypair {
  const data = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'wallets', `${name}.json`),
      'utf-8',
    ),
  );
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

// ---------------------------------------------------------------------------
// Mutable state — populated by the async bootstrap, consumed by test files
// ---------------------------------------------------------------------------

interface SetupState {
  provider: anchor.AnchorProvider;
  program: Program<Kicktick>;
  configPda: PublicKey;
  programId: PublicKey;
}

const state: Partial<SetupState> = {};

// ---------------------------------------------------------------------------
// Async bootstrap (runs when mocha loads this module via --file)
// ---------------------------------------------------------------------------

let validatorProc: ChildProcess | undefined;

async function waitForValidator(
  url: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const conn = new Connection(url, 'confirmed');

  while (Date.now() < deadline) {
    try {
      const hash = await conn.getGenesisHash();
      if (hash) return;
    } catch {
      // validator not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Validator did not start within ${timeoutMs} ms`);
}

async function bootstrap() {
  // 1. Kill any leftover validator on port 8899
  try {
    execSync('pkill -f solana-test-validator', { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 1_000));
  } catch {
    // no process to kill
  }

  // 2. Start solana-test-validator (fresh ledger via --reset)
  console.log('[setup] Starting solana-test-validator …');
  validatorProc = spawn('solana-test-validator', ['--reset', '--quiet'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  validatorProc.stdout?.on('data', (d: Buffer) =>
    process.stdout.write(`[validator] ${d}`),
  );
  validatorProc.stderr?.on('data', (d: Buffer) =>
    process.stderr.write(`[validator] ${d}`),
  );

  // 3. Wait until the JSON-RPC endpoint is live
  await waitForValidator(LOCALNET_URL);
  console.log('[setup] Validator is ready.');

  // 4. Point the CLI at localhost
  execSync('solana config set --url http://127.0.0.1:8899', {
    stdio: 'ignore',
  });

  // 5. Airdrop some SOL to the default wallet so we can pay tx fees
  const keypairPath =
    process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync(keypairPath, 'utf-8')),
    ),
  );
  const conn = new Connection(LOCALNET_URL, 'confirmed');
  const sig = await conn.requestAirdrop(
    keypair.publicKey,
    100 * LAMPORTS_PER_SOL,
  );
  await conn.confirmTransaction(sig, 'confirmed');
  console.log(`[setup] Airdropped 100 SOL to ${keypair.publicKey.toBase58()}`);

  // 6. Deploy the program via anchor deploy
  console.log('[setup] Deploying program with `anchor deploy` …');
  execSync('anchor deploy --program-name kicktick --provider.cluster localnet', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
  console.log('[setup] Program deployed.');

  // 7. Create Anchor provider + program handle
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(
    new Connection(LOCALNET_URL, 'confirmed'),
    wallet,
    { commitment: 'confirmed' },
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.Kicktick as Program<Kicktick>;
  const configPda = findConfigPda(program.programId);

  console.log(`[setup] Program ID : ${program.programId.toBase58()}`);
  console.log(`[setup] Config PDA : ${configPda.toBase58()}`);

  // 8. Init config (idempotent)
  const existing = await provider.connection.getAccountInfo(configPda);
  if (!existing) {
    console.log('[setup] Initializing config …');
    await program.methods
      .initConfig()
      .accounts({
        admin: wallet.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('[setup] Config initialized.');
  } else {
    console.log('[setup] Config already exists, skipping init.');
  }

  // 9. Populate state for test files
  Object.assign(state, {
    provider,
    program,
    configPda,
    programId: program.programId,
  });
}

// Kick off the bootstrap immediately when mocha loads this module.
// Test files await `setupReady` in their before() hooks.
const setupReady = bootstrap().catch((err) => {
  console.error('[setup] Bootstrap failed:', err);
  process.exit(1);
});

// Mocha after hook — kill validator
after(() => {
  if (validatorProc) {
    console.log('[setup] Stopping validator …');
    validatorProc.kill('SIGINT');
  }
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { state as setupExports, setupReady };

// Re-export helpers and constants for convenience
export {
  loadWallet,
  findConfigPda,
  findMarketPda,
  findMarketVaultPda,
  findUserPda,
  findUserVaultPda,
  findPositionPda,
  TXORACLE_PROGRAM_ID,
  DAILY_SCORES_MERKLE_ROOTS,
  MARKET_TYPE,
  MIN_DURATION,
  MAX_DURATION,
};
