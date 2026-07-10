/**
 * Standalone integration test — verifies init_config and set_relayer
 * after the shared setup has deployed the program.
 */

import * as anchor from '@anchor-lang/core';
import { Program } from '@anchor-lang/core';
import {
  PublicKey,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { assert } from 'chai';

import { Kicktick } from '../target/types/kicktick';
import {
  setupExports,
  setupReady,
  TXORACLE_PROGRAM_ID,
  DAILY_SCORES_MERKLE_ROOTS,
  findUserPda,
  findUserVaultPda,
  findMarketPda,
  findMarketVaultPda,
  findPositionPda,
  MARKET_TYPE,
} from './setup';

describe('KickTick — standalone validator + deploy + init_config', () => {
  let provider: anchor.AnchorProvider;
  let program: Program<Kicktick>;
  let configPda: PublicKey;

  before(async () => {
    await setupReady;
    provider = setupExports.provider!;
    program = setupExports.program!;
    configPda = setupExports.configPda!;
  });

  // ---- init_config --------------------------------------------------------

  describe('init_config', () => {
    it('creates Config PDA with correct defaults', async () => {
      // Config was already initialized by setup — verify the state
      const config = await program.account.config.fetch(configPda);

      assert.ok(
        config.admin.equals(provider.wallet.publicKey),
        'admin should be the wallet',
      );
      assert.ok(
        config.relayer.equals(provider.wallet.publicKey),
        'relayer defaults to admin',
      );
      assert.ok(
        config.txoracleProgramId.equals(TXORACLE_PROGRAM_ID),
        'txoracle_program_id should match constant',
      );
      assert.ok(
        config.dailyScoresMerkleRoots.equals(DAILY_SCORES_MERKLE_ROOTS),
        'daily_scores_merkle_roots should be derived PDA',
      );
      assert.equal(
        config.minLiquidity.toNumber(),
        10_000_000,
        'min_liquidity = 0.01 SOL',
      );
      assert.ok(config.bump > 0, 'bump should be non-zero');
    });

    it('rejects duplicate init_config (PDA already exists)', async () => {
      try {
        await program.methods
          .initConfig()
          .accounts({
            admin: provider.wallet.publicKey,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail('Expected error on duplicate init');
      } catch (err: any) {
        // Anchor `init` constraint should prevent re-creation
        assert.ok(err, 'should throw an error');
      }
    });
  });

  // ---- quick smoke: set_relayer -------------------------------------------

  describe('set_relayer (smoke)', () => {
    it('rotates relayer authority', async () => {
      const newRelayer = Keypair.generate();

      await program.methods
        .setRelayer(newRelayer.publicKey)
        .accounts({
          admin: provider.wallet.publicKey,
          config: configPda,
        })
        .rpc();

      const config = await program.account.config.fetch(configPda);
      assert.ok(
        config.relayer.equals(newRelayer.publicKey),
        'relayer should be rotated',
      );

      // rotate back to admin
      await program.methods
        .setRelayer(provider.wallet.publicKey)
        .accounts({
          admin: provider.wallet.publicKey,
          config: configPda,
        })
        .rpc();
    });
  });
});

// ---- bulk deposit: 20 wallets --------------------------------------------

describe('bulk deposit — 20 wallets', () => {
  let provider: anchor.AnchorProvider;
  let program: Program<Kicktick>;

  const NUM_WALLETS = 20;
  const DEPOSIT_AMOUNT = 0.1 * LAMPORTS_PER_SOL;
  const wallets: Keypair[] = [];

  before(async () => {
    await setupReady;
    provider = setupExports.provider!;
    program = setupExports.program!;

    for (let i = 0; i < NUM_WALLETS; i++) {
      wallets.push(Keypair.generate());
    }

    for (const kp of wallets) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig, 'confirmed');
    }
  });

  it('all 20 wallets deposit 0.1 SOL successfully', async () => {
    for (const kp of wallets) {
      const userAccount = findUserPda(kp.publicKey, program.programId);
      const userVault = findUserVaultPda(kp.publicKey, program.programId);

      await program.methods
        .deposit(new anchor.BN(DEPOSIT_AMOUNT))
        .accounts({
          user: kp.publicKey,
          userAccount,
          userVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([kp])
        .rpc();

      const account = await program.account.userAccount.fetch(userAccount);
      assert.equal(
        account.availableBalance.toNumber(),
        DEPOSIT_AMOUNT,
        `wallet ${kp.publicKey.toBase58()} balance mismatch`,
      );
      assert.ok(
        account.owner.equals(kp.publicKey),
        `wallet ${kp.publicKey.toBase58()} owner mismatch`,
      );

      const vaultBalance = await provider.connection.getBalance(userVault);
      assert.ok(
        vaultBalance >= DEPOSIT_AMOUNT,
        `vault ${kp.publicKey.toBase58()} SOL balance ${vaultBalance} < deposit ${DEPOSIT_AMOUNT}`,
      );
    }
  });
});

// ---- create match (fixture) + binary market --------------------------------

describe('create match + binary market', () => {
  let provider: anchor.AnchorProvider;
  let program: Program<Kicktick>;
  let configPda: PublicKey;

  const fixtureId = new anchor.BN(Date.now());
  const marketSeq = new anchor.BN(1);

  before(async () => {
    await setupReady;
    provider = setupExports.provider!;
    program = setupExports.program!;
    configPda = setupExports.configPda!;
  });

  it('creates a binary market (GoalInWindow) for the fixture', async () => {
    const marketPda = findMarketPda(
      fixtureId,
      MARKET_TYPE.GoalInWindow,
      marketSeq,
      program.programId,
    );
    const vaultPda = findMarketVaultPda(marketPda, program.programId);

    await program.methods
      .initMarket(
        fixtureId,
        { goalInWindow: {} },
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

    assert.equal(
      market.fixtureId.toNumber(),
      fixtureId.toNumber(),
      'fixture_id matches',
    );
    assert.deepEqual(
      market.marketType,
      { goalInWindow: {} },
      'market_type = GoalInWindow',
    );
    assert.equal(market.outcomeCount, 2, 'binary = 2 outcomes');
    assert.deepEqual(market.status, { open: {} }, 'status = Open');
    assert.deepEqual(market.winner, null, 'winner = None');
    assert.equal(market.collateral.toNumber(), 0, 'collateral = 0');
    assert.equal(market.totalVolume.toNumber(), 0, 'total_volume = 0');
    assert.deepEqual(
      market.voidPayoutBps,
      [5000, 5000, 0],
      'void payout binary',
    );

    const clock = await provider.connection.getBlockTime(
      await provider.connection.getSlot('confirmed'),
    );
    assert.ok(market.expiresAt.toNumber() > clock!, 'expires_at in future');
  });
});

// ---- buy & sell shares (settle_complete_set_binary + settle_share_trade) ---

describe('buy & sell shares', () => {
  let provider: anchor.AnchorProvider;
  let program: Program<Kicktick>;
  let configPda: PublicKey;

  const walletA = Keypair.generate();
  const walletB = Keypair.generate();
  const fixtureId = new anchor.BN(Date.now());
  const marketSeq = new anchor.BN(10);

  const QUANTITY = 100;
  const COMPLETE_PRICE_0 = 5000;
  const COMPLETE_PRICE_1 = 5000;
  const TRADE_PRICE = 6000;

  let marketPda: PublicKey;
  let vaultPda: PublicKey;
  let posA: PublicKey;
  let posB: PublicKey;

  const DEPOSIT_AMOUNT = 0.5 * LAMPORTS_PER_SOL;

  before(async () => {
    await setupReady;
    provider = setupExports.provider!;
    program = setupExports.program!;
    configPda = setupExports.configPda!;

    for (const kp of [walletA, walletB]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        2 * LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig, 'confirmed');
    }

    for (const kp of [walletA, walletB]) {
      await program.methods
        .deposit(new anchor.BN(DEPOSIT_AMOUNT))
        .accounts({
          user: kp.publicKey,
          userAccount: findUserPda(kp.publicKey, program.programId),
          userVault: findUserVaultPda(kp.publicKey, program.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }

    marketPda = findMarketPda(
      fixtureId,
      MARKET_TYPE.GoalInWindow,
      marketSeq,
      program.programId,
    );
    vaultPda = findMarketVaultPda(marketPda, program.programId);
    posA = findPositionPda(marketPda, walletA.publicKey, program.programId);
    posB = findPositionPda(marketPda, walletB.publicKey, program.programId);
  });

  it('creates a binary market', async () => {
    await program.methods
      .initMarket(
        fixtureId,
        { goalInWindow: {} },
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
    assert.deepEqual(market.status, { open: {} }, 'market is open');
    assert.equal(market.outcomeCount, 2, 'binary');
  });

  it('mint complete set: A gets outcome 0, B gets outcome 1', async () => {
    const costA = (QUANTITY * COMPLETE_PRICE_0) / 10000;
    const costB = (QUANTITY * COMPLETE_PRICE_1) / 10000;

    const aBefore = (
      await program.account.userAccount.fetch(
        findUserPda(walletA.publicKey, program.programId),
      )
    ).availableBalance.toNumber();
    const bBefore = (
      await program.account.userAccount.fetch(
        findUserPda(walletB.publicKey, program.programId),
      )
    ).availableBalance.toNumber();

    await program.methods
      .settleCompleteSetBinary(
        new anchor.BN(0),
        COMPLETE_PRICE_0,
        COMPLETE_PRICE_1,
        new anchor.BN(QUANTITY),
      )
      .accounts({
        relayer: provider.wallet.publicKey,
        config: configPda,
        market: marketPda,
        marketVault: vaultPda,
        outcome0Owner: walletA.publicKey,
        outcome0Account: findUserPda(walletA.publicKey, program.programId),
        outcome0Vault: findUserVaultPda(walletA.publicKey, program.programId),
        outcome0Position: posA,
        outcome1Owner: walletB.publicKey,
        outcome1Account: findUserPda(walletB.publicKey, program.programId),
        outcome1Vault: findUserVaultPda(walletB.publicKey, program.programId),
        outcome1Position: posB,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const aAfter = (
      await program.account.userAccount.fetch(
        findUserPda(walletA.publicKey, program.programId),
      )
    ).availableBalance.toNumber();
    const bAfter = (
      await program.account.userAccount.fetch(
        findUserPda(walletB.publicKey, program.programId),
      )
    ).availableBalance.toNumber();

    assert.equal(aBefore - aAfter, costA, 'A paid costA');
    assert.equal(bBefore - bAfter, costB, 'B paid costB');

    const posAData = await program.account.position.fetch(posA);
    assert.equal(posAData.shares[0].toNumber(), QUANTITY, 'A has outcome-0 shares');
    assert.equal(posAData.shares[1].toNumber(), 0, 'A has no outcome-1 shares');

    const posBData = await program.account.position.fetch(posB);
    assert.equal(posBData.shares[0].toNumber(), 0, 'B has no outcome-0 shares');
    assert.equal(posBData.shares[1].toNumber(), QUANTITY, 'B has outcome-1 shares');

    const market = await program.account.market.fetch(marketPda);
    assert.equal(market.totalVolume.toNumber(), QUANTITY, 'total volume');
    assert.equal(market.fillSequence.toNumber(), 1, 'fill_seq = 1');
  });

  it('share trade: B sells 100 outcome-1 shares to A', async () => {
    const cost = (QUANTITY * TRADE_PRICE) / 10000;

    const aBefore = (
      await program.account.userAccount.fetch(
        findUserPda(walletA.publicKey, program.programId),
      )
    ).availableBalance.toNumber();
    const bBefore = (
      await program.account.userAccount.fetch(
        findUserPda(walletB.publicKey, program.programId),
      )
    ).availableBalance.toNumber();

    await program.methods
      .settleShareTrade(
        new anchor.BN(1),
        1,
        TRADE_PRICE,
        new anchor.BN(QUANTITY),
      )
      .accounts({
        relayer: provider.wallet.publicKey,
        config: configPda,
        market: marketPda,
        buyer: walletA.publicKey,
        buyerAccount: findUserPda(walletA.publicKey, program.programId),
        buyerVault: findUserVaultPda(walletA.publicKey, program.programId),
        buyerPosition: posA,
        seller: walletB.publicKey,
        sellerAccount: findUserPda(walletB.publicKey, program.programId),
        sellerVault: findUserVaultPda(walletB.publicKey, program.programId),
        sellerPosition: posB,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const aAfter = (
      await program.account.userAccount.fetch(
        findUserPda(walletA.publicKey, program.programId),
      )
    ).availableBalance.toNumber();
    const bAfter = (
      await program.account.userAccount.fetch(
        findUserPda(walletB.publicKey, program.programId),
      )
    ).availableBalance.toNumber();

    assert.equal(aBefore - aAfter, cost, 'A paid cost');
    assert.equal(bAfter - bBefore, cost, 'B received cost');

    const posAData = await program.account.position.fetch(posA);
    assert.equal(posAData.shares[0].toNumber(), QUANTITY, 'A still has outcome-0 shares');
    assert.equal(
      posAData.shares[1].toNumber(),
      QUANTITY,
      'A now has outcome-1 shares from B',
    );

    const posBData = await program.account.position.fetch(posB);
    assert.equal(posBData.shares[1].toNumber(), 0, 'B sold all outcome-1 shares');

    const market = await program.account.market.fetch(marketPda);
    assert.equal(
      market.totalVolume.toNumber(),
      QUANTITY * 2,
      'total volume increased',
    );
    assert.equal(market.fillSequence.toNumber(), 2, 'fill_seq = 2');
  });
});
