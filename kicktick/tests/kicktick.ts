// Native SOL migration — no USDT, no token accounts.
// Relies on init_config instruction to bootstrap Config PDA.

import * as anchor from '@anchor-lang/core';
import { Program } from '@anchor-lang/core';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';

import { Kicktick } from '../target/types/kicktick';

const SEED_CONFIG = Buffer.from('config');
const SEED_MATCH = Buffer.from('match');
const SEED_MATCH_VAULT = Buffer.from('match_vault');
const SEED_SESSION_BUDGET = Buffer.from('session_budget');
const SEED_ROUND = Buffer.from('round');
const SEED_POSITION = Buffer.from('position');

describe('KickTick (Native SOL)', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Kicktick as Program<Kicktick>;
  const admin = provider.wallet;

  let configPda: PublicKey;
  let matchPda: PublicKey;
  let vaultPda: PublicKey;

  const fixtureId = new anchor.BN(54321);
  const homeTeam = 'Home FC';
  const awayTeam = 'Away United';
  const depositAmount = new anchor.BN(100_000_000); // 0.1 SOL
  const betAmount = new anchor.BN(10_000_000); // 0.01 SOL
  const roundId = new anchor.BN(1);

  before(async () => {
    configPda = PublicKey.findProgramAddressSync(
      [SEED_CONFIG],
      program.programId,
    )[0];

    // Bootstrap Config if not exists
    const existing = await provider.connection.getAccountInfo(configPda);
    if (existing) return;

    await (program.methods.initConfig() as any)
      .accountsStrict({
        admin: admin.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const created = await provider.connection.getAccountInfo(configPda);
    if (!created) throw new Error('init_config failed');
  });

  it('1. init_match creates match PDA (no token vault)', async () => {
    matchPda = PublicKey.findProgramAddressSync(
      [SEED_MATCH, fixtureId.toArrayLike(Buffer, 'le', 8)],
      program.programId,
    )[0];
    vaultPda = PublicKey.findProgramAddressSync(
      [SEED_MATCH_VAULT, matchPda.toBuffer()],
      program.programId,
    )[0];

    await (program.methods
      .initMatch(fixtureId, homeTeam, awayTeam) as any)
      .accountsStrict({
        creator: admin.publicKey,
        config: configPda,
        matchPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const matchAccount = await program.account.match.fetch(matchPda);
    assert.equal(matchAccount.fixtureId.toNumber(), fixtureId.toNumber());
    assert.equal(matchAccount.homeTeam.trimEnd(), homeTeam);
    assert.equal(matchAccount.awayTeam.trimEnd(), awayTeam);
    assert.ok(matchAccount.vaultBump > 0, 'vault bump derived');
    assert.equal(matchAccount.totalDeposited.toNumber(), 0);
    assert.equal(matchAccount.totalSponsored.toNumber(), 0);
  });

  it('2. fund_session_budget sends SOL to vault PDA', async () => {
    const matchBefore = await program.account.match.fetch(matchPda);

    const budgetPda = PublicKey.findProgramAddressSync(
      [SEED_SESSION_BUDGET, admin.publicKey.toBuffer(), matchPda.toBuffer()],
      program.programId,
    )[0];

    await (program.methods
      .fundSessionBudget(depositAmount) as any)
      .accountsStrict({
        user: admin.publicKey,
        budget: budgetPda,
        matchPda,
        matchVault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const matchAfter = await program.account.match.fetch(matchPda);
    assert.equal(
      matchAfter.totalDeposited.toNumber(),
      matchBefore.totalDeposited.toNumber() + depositAmount.toNumber(),
    );

    const vaultBalance = await provider.connection.getBalance(vaultPda);
    assert.equal(vaultBalance, depositAmount.toNumber());
  });

  it('3. open_round + place_bet (no token accounts)', async () => {
    const roundPda = PublicKey.findProgramAddressSync(
      [SEED_ROUND, matchPda.toBuffer(), roundId.toArrayLike(Buffer, 'le', 8)],
      program.programId,
    )[0];

    await (program.methods
      .openRound(roundId, { varCheck: {} }, new anchor.BN(15), new anchor.BN(16)) as any)
      .accountsStrict({
        authority: admin.publicKey,
        matchPda,
        round: roundPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const budgetPda = PublicKey.findProgramAddressSync(
      [SEED_SESSION_BUDGET, admin.publicKey.toBuffer(), matchPda.toBuffer()],
      program.programId,
    )[0];
    const positionPda = PublicKey.findProgramAddressSync(
      [
        SEED_POSITION,
        fixtureId.toArrayLike(Buffer, 'le', 8),
        roundId.toArrayLike(Buffer, 'le', 8),
        admin.publicKey.toBuffer(),
      ],
      program.programId,
    )[0];

    const budgetBefore = await program.account.sessionBudget.fetch(budgetPda);

    await (program.methods
      .placeBet(fixtureId, roundId, 0 /* YES */, betAmount) as any)
      .accountsStrict({
        bettor: admin.publicKey,
        budget: budgetPda,
        matchPda,
        round: roundPda,
        position: positionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const budgetAfter = await program.account.sessionBudget.fetch(budgetPda);
    assert.equal(
      budgetAfter.usedAmount.toNumber(),
      budgetBefore.usedAmount.toNumber() + betAmount.toNumber(),
    );

    const roundAccount = await program.account.round.fetch(roundPda);
    assert.equal(roundAccount.totalYes.toNumber(), betAmount.toNumber());
  });

  it('4. settle_offchain verifies winner/side numbering fix', async () => {
    const roundPda = PublicKey.findProgramAddressSync(
      [SEED_ROUND, matchPda.toBuffer(), roundId.toArrayLike(Buffer, 'le', 8)],
      program.programId,
    )[0];
    const positionPda = PublicKey.findProgramAddressSync(
      [SEED_POSITION, fixtureId.toArrayLike(Buffer, 'le', 8), roundId.toArrayLike(Buffer, 'le', 8), admin.publicKey.toBuffer()],
      program.programId,
    )[0];

    // Sleep until round.expires_at (now + 16s, +1s buffer)
    await new Promise(r => setTimeout(r, 17000));

    // Settle round — OffChain market (VARCheck), winner=1 (YES)
    await (program.methods
      .settleOffchainRound({ yes: {} }, 1) as any)
      .accountsStrict({
        caller: admin.publicKey,
        matchPda,
        round: roundPda,
      })
      .rpc();

    // Read round and position state
    const roundAfter = await program.account.round.fetch(roundPda);
    const posAfter = await program.account.position.fetch(positionPda);

    console.log(`  round.winner = ${roundAfter.winner}`);
    console.log(`  position.side = ${posAfter.side}`);

    // Fix logic: round.winner - 1 maps to position.side
    // zero=refund (handled before payout), 1=YES=>0, 2=NO=>1, 3=abstain=>2
    assert.equal(
      roundAfter.winner! - 1,
      posAfter.side,
      'winner/side numbering mismatch: fix is in claim.rs:56',
    );
  });
});
