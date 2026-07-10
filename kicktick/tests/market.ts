import * as anchor from '@anchor-lang/core';
import { Program } from '@anchor-lang/core';
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { assert } from 'chai';

import { Kicktick } from '../target/types/kicktick';
import {
  setupExports,
  setupReady,
  loadWallet,
  findConfigPda,
  findMarketPda,
  findMarketVaultPda,
  MARKET_TYPE,
  MIN_DURATION,
  MAX_DURATION,
} from './setup';

describe('Market lifecycle', () => {
  let provider: anchor.AnchorProvider;
  let program: Program<Kicktick>;
  let configPda: PublicKey;

  const relayer = loadWallet('wallet-06');

  before(async () => {
    await setupReady;
    provider = setupExports.provider!;
    program = setupExports.program!;
    configPda = setupExports.configPda!;

    // Fund relayer for tx fees
    const fundTx = new (await import('@solana/web3.js')).Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: relayer.publicKey,
        lamports: 2 * LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(fundTx);

    // Rotate relayer
    await program.methods.setRelayer(relayer.publicKey).accounts({ admin: provider.wallet.publicKey, config: configPda }).rpc();
  });

  // ============================================================
  // init_market
  // ============================================================

  describe('init_market', () => {
    it('creates a binary market (VARCheck) with correct defaults', async () => {
      const fixtureId = new anchor.BN(Date.now());
      const marketSeq = new anchor.BN(1);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { varCheck: {} },
          marketSeq,
          { participant: 1, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(120),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.fixtureId.toNumber(), fixtureId, 'fixture_id');
      assert.deepEqual(market.marketType, { varCheck: {} }, 'market_type');
      assert.equal(market.marketSeq.toNumber(), marketSeq, 'market_seq');
      assert.equal(market.outcomeCount, 2, 'binary outcome count');
      assert.deepEqual(market.status, { open: {} }, 'status = Open');
      assert.deepEqual(market.winner, null, 'winner = None');
      assert.equal(market.resolvedAt.toNumber(), 0, 'resolved_at = 0');
      assert.deepEqual(market.voidPayoutBps, [5000, 5000, 0], 'void payout binary');
      assert.equal(market.collateral.toNumber(), 0, 'collateral = 0');
      assert.equal(market.totalVolume.toNumber(), 0, 'total_volume = 0');
      assert.equal(market.fillSequence.toNumber(), 0, 'fill_sequence = 0');
      assert.equal(market.openPositions.toNumber(), 0, 'open_positions = 0');

      // expires_at > now
      const clock = await provider.connection.getBlockTime(
        await provider.connection.getSlot('confirmed'),
      );
      assert.ok(market.expiresAt.toNumber() > clock!, 'expires_at in future');
    });

    it('creates a ternary market (NextGoalSide) with 3 outcomes', async () => {
      const fixtureId = new anchor.BN(Date.now() + 1);
      const marketSeq = new anchor.BN(2);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.NextGoalSide, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { nextGoalSide: {} },
          marketSeq,
          { participant: 1, period: 1000, baselineA: 0, baselineB: 0 },
          new anchor.BN(60),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.outcomeCount, 3, 'ternary outcome count');
      assert.deepEqual(market.voidPayoutBps, [3334, 3333, 3333], 'void payout ternary');
    });

    it('creates a ternary market (PenaltyShootoutShot) with 3 outcomes', async () => {
      const fixtureId = new anchor.BN(Date.now() + 1);
      const marketSeq = new anchor.BN(3);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShootoutShot, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShootoutShot: {} },
          marketSeq,
          { participant: 1, period: 5000, baselineA: 0, baselineB: 0 },
          new anchor.BN(60),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.outcomeCount, 3, 'shootout outcome count');
      assert.deepEqual(market.voidPayoutBps, [3334, 3333, 3333], 'void payout shootout');
    });

    it('rejects fixture_id <= 0', async () => {
      const fixtureId = new anchor.BN(0);
      const marketSeq = new anchor.BN(100);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      try {
        await program.methods
          .initMarket(
            fixtureId,
            { varCheck: {} },
            marketSeq,
            { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
            new anchor.BN(1),
          )
          .accounts({
            authority: provider.wallet.publicKey,
            config: configPda,
            market: marketPda,
            marketVault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail('Expected InvalidFixtureId error');
      } catch (err: any) {
        assert.ok(err.toString().includes('InvalidFixtureId'), `Expected InvalidFixtureId, got: ${err}`);
      }
    });

    it('rejects deadline below MIN_MARKET_DURATION (15s)', async () => {
      const fixtureId = new anchor.BN(Date.now() + 2);
      const marketSeq = new anchor.BN(101);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      try {
        await program.methods
          .initMarket(
            fixtureId,
            { varCheck: {} },
            marketSeq,
            { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
            new anchor.BN(10),
          )
          .accounts({
            authority: provider.wallet.publicKey,
            config: configPda,
            market: marketPda,
            marketVault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail('Expected InvalidDuration error');
      } catch (err: any) {
        assert.ok(err.toString().includes('InvalidDuration'), `Expected InvalidDuration, got: ${err}`);
      }
    });

    it('rejects deadline above MAX_MARKET_DURATION (300s)', async () => {
      const fixtureId = new anchor.BN(Date.now() + 3);
      const marketSeq = new anchor.BN(102);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      try {
        await program.methods
          .initMarket(
            fixtureId,
            { varCheck: {} },
            marketSeq,
            { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
            new anchor.BN(301),
          )
          .accounts({
            authority: provider.wallet.publicKey,
            config: configPda,
            market: marketPda,
            marketVault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail('Expected InvalidDuration error');
      } catch (err: any) {
        assert.ok(err.toString().includes('InvalidDuration'), `Expected InvalidDuration, got: ${err}`);
      }
    });

    it('rejects non-admin authority', async () => {
      const fixtureId = new anchor.BN(Date.now() + 4);
      const marketSeq = new anchor.BN(103);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      try {
        await program.methods
          .initMarket(
            fixtureId,
            { varCheck: {} },
            marketSeq,
            { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
            new anchor.BN(1),
          )
          .accounts({
            authority: relayer.publicKey,
            config: configPda,
            market: marketPda,
            marketVault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([relayer])
          .rpc();
        assert.fail('Expected Unauthorized error');
      } catch (err: any) {
        assert.ok(err.toString().includes('Unauthorized'), `Expected Unauthorized, got: ${err}`);
      }
    });

    it('rejects duplicate market PDA (same fixture + type + seq)', async () => {
      const fixtureId = new anchor.BN(Date.now() + 5);
      const marketSeq = new anchor.BN(200);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      const params = { participant: 0, period: 0, baselineA: 0, baselineB: 0 };

      await program.methods
        .initMarket(fixtureId, { varCheck: {} }, marketSeq, params, new anchor.BN(MIN_DURATION))
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Second init on same PDA should fail
      try {
        await program.methods
          .initMarket(fixtureId, { varCheck: {} }, marketSeq, params, new anchor.BN(MIN_DURATION))
          .accounts({
            authority: provider.wallet.publicKey,
            config: configPda,
            market: marketPda,
            marketVault: vaultPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail('Expected account already exists error');
      } catch (err: any) {
        // Anchor's init constraint or account already initialized
        assert.ok(err.toString().includes('Error'), `Expected error, got: ${err}`);
      }
    });

    it('accepts boundary duration MIN_MARKET_DURATION (15s)', async () => {
      const fixtureId = new anchor.BN(Date.now() + 6);
      const marketSeq = new anchor.BN(300);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { varCheck: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(MIN_DURATION),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.outcomeCount, 2, 'market created');
    });

    it('accepts boundary duration MAX_MARKET_DURATION (300s)', async () => {
      const fixtureId = new anchor.BN(Date.now() + 7);
      const marketSeq = new anchor.BN(301);
      const marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      const vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { varCheck: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(MAX_DURATION),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.equal(market.outcomeCount, 2, 'market created');
    });
  });

  // ============================================================
  // lock_market
  // ============================================================

  describe('lock_market', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
      const fixtureId = new anchor.BN(Date.now() + 100);
      const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it('relayer can lock an Open market', async () => {
      await program.methods
        .lockMarket()
        .accounts({
          authority: relayer.publicKey,
          config: configPda,
          market: marketPda,
        })
        .signers([relayer])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { locked: {} }, 'status = Locked');
    });

    it('rejects locking a non-Open market', async () => {
      try {
        await program.methods
          .lockMarket()
          .accounts({
            authority: relayer.publicKey,
            config: configPda,
            market: marketPda,
          })
          .signers([relayer])
          .rpc();
        assert.fail('Expected MarketNotOpen error');
      } catch (err: any) {
        assert.ok(err.toString().includes('MarketNotOpen'), `Expected MarketNotOpen, got: ${err}`);
      }
    });
  });

  describe('lock_market (expiration)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      // Create with MIN duration so it expires fast
      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(120),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it('non-relayer can lock after expiration', async () => {
      // Wait for market to expire
      await new Promise((r) => setTimeout(r, (MIN_DURATION + 2) * 1000));

      // A random non-relayer keypair should be able to lock after expiry
      const passerby = loadWallet('wallet-07');

      await program.methods
        .lockMarket()
        .accounts({
          authority: passerby.publicKey,
          config: configPda,
          market: marketPda,
        })
        .signers([passerby])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { locked: {} }, 'locked by passerby after expiry');
    });
  });

  describe('lock_market (non-relayer before expiry)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(MAX_DURATION),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it('rejects non-relayer locking before expiry', async () => {
      const stranger = loadWallet('wallet-08');

      try {
        await program.methods
          .lockMarket()
          .accounts({
            authority: stranger.publicKey,
            config: configPda,
            market: marketPda,
          })
          .signers([stranger])
          .rpc();
        assert.fail('Expected UnauthorizedRelayer error');
      } catch (err: any) {
        assert.ok(err.toString().includes('UnauthorizedRelayer'), `Expected UnauthorizedRelayer, got: ${err}`);
      }
    });
  });

  // ============================================================
  // resolve_market_offchain (PenaltyShot / VARCheck only)
  // ============================================================

  describe('resolve_market_offchain', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(120),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Lock as relayer
      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();
    });

    it('relayer resolves locked market to ResolvedPending', async () => {
      await program.methods
        .resolveMarketOffchain(0)
        .accounts({ relayer: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { resolvedPending: {} }, 'status = ResolvedPending');
      assert.deepEqual(market.winner, { value: 0 }, 'winner = Some(0)');
      assert.ok(market.resolvedAt.toNumber() > 0, 'resolved_at set');
    });

    it('rejects resolving a ResolvedPending market', async () => {
      try {
        await program.methods
          .resolveMarketOffchain(1)
          .accounts({ relayer: relayer.publicKey, config: configPda, market: marketPda })
          .signers([relayer])
          .rpc();
        assert.fail('Expected MarketNotLocked error');
      } catch (err: any) {
        assert.ok(err.toString().includes('MarketNotLocked'), `Expected MarketNotLocked, got: ${err}`);
      }
    });
  });

  describe('resolve_market_offchain (oracle-required type)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      // GoalInWindow requires oracle
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.GoalInWindow, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { goalInWindow: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();
    });

    it('rejects offchain resolution for oracle-required market type', async () => {
      try {
        await program.methods
          .resolveMarketOffchain(0)
          .accounts({ relayer: relayer.publicKey, config: configPda, market: marketPda })
          .signers([relayer])
          .rpc();
        assert.fail('Expected OracleResolutionRequired error');
      } catch (err: any) {
        assert.ok(err.toString().includes('OracleResolutionRequired'), `Expected OracleResolutionRequired, got: ${err}`);
      }
    });
  });

  describe('resolve_market_offchain (invalid outcome index)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { varCheck: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();
    });

    it('rejects winner >= outcome_count', async () => {
      try {
        // VARCheck is binary (2 outcomes), winner=2 is invalid
        await program.methods
          .resolveMarketOffchain(2)
          .accounts({ relayer: relayer.publicKey, config: configPda, market: marketPda })
          .signers([relayer])
          .rpc();
        assert.fail('Expected InvalidOutcomeIndex error');
      } catch (err: any) {
        assert.ok(err.toString().includes('InvalidOutcomeIndex'), `Expected InvalidOutcomeIndex, got: ${err}`);
      }
    });
  });

  describe('resolve_market_offchain (non-relayer)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { varCheck: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();
    });

    it('rejects non-relayer caller', async () => {
      try {
        await program.methods
          .resolveMarketOffchain(0)
          .accounts({ relayer: provider.wallet.publicKey, config: configPda, market: marketPda })
          .rpc();
        assert.fail('Expected UnauthorizedRelayer error');
      } catch (err: any) {
        assert.ok(err.toString().includes('UnauthorizedRelayer'), `Expected UnauthorizedRelayer, got: ${err}`);
      }
    });
  });

  // ============================================================
  // confirm_market
  // ============================================================

  describe('confirm_market', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(120),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();

      await program.methods
        .resolveMarketOffchain(0)
        .accounts({ relayer: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();
    });

    it('confirms immediately after resolve', async () => {
      await program.methods
        .confirmMarket()
        .accounts({ config: configPda, market: marketPda })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { resolved: {} }, 'status = Resolved');
    });
  });

  describe('confirm_market (wrong status)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { varCheck: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it('rejects confirmation on Open market', async () => {
      try {
        await program.methods
          .confirmMarket()
          .accounts({ config: configPda, market: marketPda })
          .rpc();
        assert.fail('Expected MarketNotResolved error');
      } catch (err: any) {
        assert.ok(err.toString().includes('MarketNotResolved'), `Expected MarketNotResolved, got: ${err}`);
      }
    });
  });

  // ============================================================
  // void_market
  // ============================================================

  describe('void_market (from Open)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { varCheck: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it('admin can void an Open market', async () => {
      await program.methods
        .voidMarket()
        .accounts({ authority: provider.wallet.publicKey, config: configPda, market: marketPda })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { voided: {} }, 'status = Voided');
      assert.deepEqual(market.winner, null, 'winner cleared');
    });
  });

  describe('void_market (from Locked)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();
    });

    it('admin can void a Locked market', async () => {
      await program.methods
        .voidMarket()
        .accounts({ authority: provider.wallet.publicKey, config: configPda, market: marketPda })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { voided: {} }, 'status = Voided');
    });
  });

  describe('void_market (from ResolvedPending)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(120),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();

      await program.methods
        .resolveMarketOffchain(0)
        .accounts({ relayer: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();
    });

    it('admin can void a ResolvedPending market', async () => {
      await program.methods
        .voidMarket()
        .accounts({ authority: provider.wallet.publicKey, config: configPda, market: marketPda })
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { voided: {} }, 'status = Voided');
    });
  });

  describe('void_market (reject terminal states)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(120),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();

      await program.methods
        .resolveMarketOffchain(0)
        .accounts({ relayer: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();

      // Confirm immediately
      await program.methods
        .confirmMarket()
        .accounts({ config: configPda, market: marketPda })
        .rpc();
    });

    it('rejects voiding a Resolved market', async () => {
      try {
        await program.methods
          .voidMarket()
          .accounts({ authority: provider.wallet.publicKey, config: configPda, market: marketPda })
          .rpc();
        assert.fail('Expected MarketNotTerminal error');
      } catch (err: any) {
        assert.ok(err.toString().includes('MarketNotTerminal'), `Expected MarketNotTerminal, got: ${err}`);
      }
    });
  });

  describe('void_market (reject non-admin)', () => {
    let marketPda: PublicKey;
    let vaultPda: PublicKey;
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.VARCheck, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);

      await program.methods
        .initMarket(
          fixtureId,
          { varCheck: {} },
          marketSeq,
          { participant: 0, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it('rejects non-admin void', async () => {
      try {
        await program.methods
          .voidMarket()
          .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
          .signers([relayer])
          .rpc();
        assert.fail('Expected Unauthorized error');
      } catch (err: any) {
        assert.ok(err.toString().includes('Unauthorized'), `Expected Unauthorized, got: ${err}`);
      }
    });
  });

  // ============================================================
  // Full lifecycle (happy path)
  // ============================================================

  describe('full lifecycle (init → lock → resolve → confirm)', () => {
    const fixtureId = new anchor.BN(Date.now());
    const marketSeq = new anchor.BN(1);
    let marketPda: PublicKey;
    let vaultPda: PublicKey;

    before(async () => {
      marketPda = findMarketPda(fixtureId, MARKET_TYPE.PenaltyShot, marketSeq, program.programId);
      vaultPda = findMarketVaultPda(marketPda, program.programId);
    });

    it('completes full lifecycle with status transitions', async () => {
      // 1. Init
      await program.methods
        .initMarket(
          fixtureId,
          { penaltyShot: {} },
          marketSeq,
          { participant: 1, period: 0, baselineA: 0, baselineB: 0 },
          new anchor.BN(1),
        )
        .accounts({
          authority: provider.wallet.publicKey,
          config: configPda,
          market: marketPda,
          marketVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      let market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { open: {} }, 'after init: Open');

      // 2. Lock
      await program.methods
        .lockMarket()
        .accounts({ authority: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();

      market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { locked: {} }, 'after lock: Locked');

      // 3. Resolve
      await program.methods
        .resolveMarketOffchain(1)
        .accounts({ relayer: relayer.publicKey, config: configPda, market: marketPda })
        .signers([relayer])
        .rpc();

      market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { resolvedPending: {} }, 'after resolve: ResolvedPending');
      assert.deepEqual(market.winner, { value: 1 }, 'winner = 1');

      // 4. Confirm (immediate)
      await program.methods
        .confirmMarket()
        .accounts({ config: configPda, market: marketPda })
        .rpc();

      market = await program.account.market.fetch(marketPda);
      assert.deepEqual(market.status, { resolved: {} }, 'after confirm: Resolved');
    });
  });
});
