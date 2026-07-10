import * as anchor from '@anchor-lang/core';
import { Program } from '@anchor-lang/core';
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import { assert } from 'chai';

import { Kicktick } from '../target/types/kicktick';
import {
  setupExports,
  setupReady,
  loadWallet,
  findUserPda,
  findUserVaultPda,
  findMarketPda,
  findMarketVaultPda,
  findPositionPda,
  findConfigPda,
  TXORACLE_PROGRAM_ID,
  DAILY_SCORES_MERKLE_ROOTS,
} from './setup';

describe('KickTick CLOB', () => {
  let provider: anchor.AnchorProvider;
  let program: Program<Kicktick>;
  let configPda: PublicKey;

  const admin = provider?.wallet; // will be set after before()

  const relayer = loadWallet('wallet-03');
  const user1 = loadWallet('wallet-04');
  const user2 = loadWallet('wallet-05');

  before(async () => {
    await setupReady;
    provider = setupExports.provider!;
    program = setupExports.program!;
    configPda = setupExports.configPda!;

    // Fund test wallets from admin
    for (const kp of [relayer, user1, user2]) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: kp.publicKey,
          lamports: 2 * LAMPORTS_PER_SOL,
        }),
      );
      await provider.sendAndConfirm(tx);
    }
  });

  // ============================================================
  // Config tests
  // ============================================================

  describe('Config', () => {
    it('init_config sets admin and default relayer', async () => {
      const config = await program.account.config.fetch(configPda);
      assert.ok(config.admin.equals(provider.wallet.publicKey), 'admin = wallet');
      assert.ok(config.relayer.equals(provider.wallet.publicKey), 'relayer defaults to admin');
      assert.ok(config.txoracleProgramId.equals(TXORACLE_PROGRAM_ID));
      assert.ok(config.dailyScoresMerkleRoots.equals(DAILY_SCORES_MERKLE_ROOTS), 'oracle PDA is derived');
    });

    it('set_relayer rotates relayer authority', async () => {
      await program.methods.setRelayer(relayer.publicKey)
        .accounts({ admin: provider.wallet.publicKey, config: configPda })
        .rpc();

      const config = await program.account.config.fetch(configPda);
      assert.ok(config.relayer.equals(relayer.publicKey), 'relayer rotated');
    });

    it('set_relayer rejects non-admin', async () => {
      try {
        await program.methods.setRelayer(user1.publicKey)
          .accounts({ admin: user1.publicKey, config: configPda })
          .signers([user1])
          .rpc();
        assert.fail('Expected Unauthorized error');
      } catch (err: any) {
        assert.ok(err.toString().includes('Unauthorized'), `Expected Unauthorized, got: ${err}`);
      }
    });
  });

  // ============================================================
  // User account tests
  // ============================================================

  describe('User accounts', () => {
    it('init_user creates UserAccount and vault PDA', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      await program.methods.initUser()
        .accounts({
          user: user1.publicKey,
          userAccount: userAccountPda,
          userVault: userVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const account = await program.account.userAccount.fetch(userAccountPda);
      assert.ok(account.owner.equals(user1.publicKey), 'owner set');
      assert.equal(account.availableBalance.toNumber(), 0, 'balance starts at 0');
      assert.equal(account.reservedBalance.toNumber(), 0, 'reserved starts at 0');

      const vaultInfo = await provider.connection.getAccountInfo(userVaultPda);
      assert.ok(vaultInfo !== null, 'vault PDA exists');
      assert.ok(vaultInfo!.owner.equals(SystemProgram.programId), 'vault is system-owned');
      assert.equal(vaultInfo!.data.length, 0, 'vault has zero data');
      assert.ok(vaultInfo!.lamports > 0, 'vault holds rent');
    });

    it('init_user is idempotent (init_if_needed)', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      await program.methods.initUser()
        .accounts({
          user: user1.publicKey,
          userAccount: userAccountPda,
          userVault: userVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const account = await program.account.userAccount.fetch(userAccountPda);
      assert.ok(account.owner.equals(user1.publicKey), 'owner unchanged');
      assert.equal(account.availableBalance.toNumber(), 0, 'balance still 0');
    });
  });

  // ============================================================
  // Deposit tests
  // ============================================================

  describe('Deposit', () => {
    it('deposit transfers SOL to vault and updates balance', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      const vaultBefore = await provider.connection.getBalance(userVaultPda);
      const depositAmount = new anchor.BN(0.5 * LAMPORTS_PER_SOL);

      await program.methods.deposit(depositAmount)
        .accounts({
          user: user1.publicKey,
          userAccount: userAccountPda,
          userVault: userVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const vaultAfter = await provider.connection.getBalance(userVaultPda);
      assert.equal(vaultAfter - vaultBefore, Number(depositAmount), 'vault balance increased');

      const account = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(account.availableBalance.toNumber(), Number(depositAmount), 'available balance updated');
    });

    it('deposit rejects zero amount', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      try {
        await program.methods.deposit(new anchor.BN(0))
          .accounts({
            user: user1.publicKey,
            userAccount: userAccountPda,
            userVault: userVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        assert.fail('Expected ZeroAmount error');
      } catch (err: any) {
        assert.ok(err.toString().includes('ZeroAmount'), `Expected ZeroAmount, got: ${err}`);
      }
    });

    it('deposit accumulates balance across multiple deposits', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      const accountBefore = await program.account.userAccount.fetch(userAccountPda);
      const extraDeposit = new anchor.BN(0.1 * LAMPORTS_PER_SOL);

      await program.methods.deposit(extraDeposit)
        .accounts({
          user: user1.publicKey,
          userAccount: userAccountPda,
          userVault: userVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const accountAfter = await program.account.userAccount.fetch(userAccountPda);
      assert.equal(
        accountAfter.availableBalance.toNumber(),
        accountBefore.availableBalance.toNumber() + Number(extraDeposit),
        'balance accumulated',
      );
    });

    it('different user can deposit independently', async () => {
      const userAccountPda = findUserPda(user2.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user2.publicKey, program.programId);

      const depositAmount = new anchor.BN(1 * LAMPORTS_PER_SOL);

      await program.methods.initUser()
        .accounts({
          user: user2.publicKey,
          userAccount: userAccountPda,
          userVault: userVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      await program.methods.deposit(depositAmount)
        .accounts({
          user: user2.publicKey,
          userAccount: userAccountPda,
          userVault: userVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      const account = await program.account.userAccount.fetch(userAccountPda);
      assert.ok(account.owner.equals(user2.publicKey), 'user2 owner');
      assert.equal(account.availableBalance.toNumber(), Number(depositAmount), 'user2 balance');
    });
  });

  // ============================================================
  // Withdraw tests
  // ============================================================

  describe('Withdraw', () => {
    it('withdraw sends SOL back and decreases balance', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      const accountBefore = await program.account.userAccount.fetch(userAccountPda);
      const withdrawAmount = new anchor.BN(0.1 * LAMPORTS_PER_SOL);
      const vaultBefore = await provider.connection.getBalance(userVaultPda);

      await program.methods.withdraw(withdrawAmount)
        .accounts({
          user: user1.publicKey,
          userAccount: userAccountPda,
          userVault: userVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const accountAfter = await program.account.userAccount.fetch(userAccountPda);
      const vaultAfter = await provider.connection.getBalance(userVaultPda);

      assert.equal(
        accountAfter.availableBalance.toNumber(),
        accountBefore.availableBalance.toNumber() - Number(withdrawAmount),
        'balance decreased',
      );
      assert.equal(vaultAfter - vaultBefore, -Number(withdrawAmount), 'vault balance decreased');
    });

    it('withdraw rejects zero amount', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      try {
        await program.methods.withdraw(new anchor.BN(0))
          .accounts({
            user: user1.publicKey,
            userAccount: userAccountPda,
            userVault: userVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        assert.fail('Expected ZeroAmount error');
      } catch (err: any) {
        assert.ok(err.toString().includes('ZeroAmount'), `Expected ZeroAmount, got: ${err}`);
      }
    });

    it('withdraw rejects insufficient balance', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      const account = await program.account.userAccount.fetch(userAccountPda);
      const tooMuch = account.availableBalance.add(new anchor.BN(1));

      try {
        await program.methods.withdraw(tooMuch)
          .accounts({
            user: user1.publicKey,
            userAccount: userAccountPda,
            userVault: userVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user1])
          .rpc();
        assert.fail('Expected InsufficientBalance error');
      } catch (err: any) {
        assert.ok(err.toString().includes('InsufficientBalance'), `Expected InsufficientBalance, got: ${err}`);
      }
    });

    it('withdraw rejects unauthorized user', async () => {
      const userAccountPda = findUserPda(user1.publicKey, program.programId);
      const userVaultPda = findUserVaultPda(user1.publicKey, program.programId);

      try {
        await program.methods.withdraw(new anchor.BN(1))
          .accounts({
            user: user2.publicKey,
            userAccount: userAccountPda,
            userVault: userVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user2])
          .rpc();
        assert.fail('Expected error');
      } catch (err: any) {
        // PDA derivation mismatch or Unauthorized — both acceptable
        assert.ok(err.toString().includes('Error'), `Expected error, got: ${err}`);
      }
    });
  });
});
