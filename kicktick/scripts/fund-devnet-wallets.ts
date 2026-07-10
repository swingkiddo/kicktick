#!/usr/bin/env npx ts-node
// Batch wallet creation + funding for devnet testing.
// Uses master-wallet approach: airdrop SOL once → distribute via transfer.
//
// Usage:
//   npx ts-node scripts/fund-devnet-wallets.ts
//   npx ts-node scripts/fund-devnet-wallets.ts --count 20 --sol 0.5 --outdir ./wallets
//   npx ts-node scripts/fund-devnet-wallets.ts --cluster localnet --count 5
//
// Master wallet priority:
//   1. Positional arg @path (e.g. npx ts-node scripts/fund-devnet-wallets.ts @~/my-keypair.json)
//   2. SOLANA_PRIVATE_KEY env var (JSON array or base58)
//   3. <project>/kicktick-deployer.json
//   4. Generated fresh (saved to wallets/master.json)

import {
  PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL,
  Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as anchor from '@anchor-lang/core';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const LOCALNET_URL = 'http://localhost:8899';
const DEF_COUNT = 10;
const DEF_SOL_PER_WALLET = 0.5;
const DEF_MASTER_SOL = 10;

interface Args {
  cluster: string;
  count: number;
  solPerWallet: number;
  masterSol: number;
  outdir: string;
  keypairPath: string | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, def: string): string => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
  };

  let keypairPath: string | null = null;
  // first positional arg starting with @ → keypair file
  if (argv.length > 0 && argv[0].startsWith('@')) {
    keypairPath = path.resolve(argv[0].slice(1));
  }

  return {
    cluster: get('--cluster', 'devnet'),
    count: parseInt(get('--count', String(DEF_COUNT)), 10),
    solPerWallet: parseFloat(get('--sol', String(DEF_SOL_PER_WALLET))),
    masterSol: parseFloat(get('--master-sol', String(DEF_MASTER_SOL))),
    outdir: path.resolve(get('--outdir', './wallets')),
    keypairPath,
  };
}

function loadKeypair(path: string): Keypair {
  const raw = fs.readFileSync(path, 'utf-8').trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }
  } catch { /* not json, try bs58 */ }
  const bs58 = require('bs58');
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function airdropWithRetry(
  conn: anchor.web3.Connection,
  pk: PublicKey,
  lamports: number,
  label = '',
): Promise<void> {
  for (let i = 0; i < 10; i++) {
    try {
      const sig = await conn.requestAirdrop(pk, lamports);
      await conn.confirmTransaction(sig, 'confirmed');
      return;
    } catch (e: any) {
      const msg = e.message ?? String(e);
      if (msg.includes('429') || msg.includes('too many')) {
        const delay = Math.min(2000 * (2 ** i), 30000);
        console.log(`  rate limit${label ? ` (${label})` : ''}, retry ${i+1}/10 in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      if (msg.includes('already in use')) {
        console.log(`  already funded${label ? ` (${label})` : ''}, skip`);
        return;
      }
      throw e;
    }
  }
  throw new Error(`airdrop failed after 10 retries${label ? ` (${label})` : ''}`);
}

async function main() {
  const args = parseArgs();
  const url = args.cluster === 'localnet' ? LOCALNET_URL : DEVNET_URL;
  const conn = new anchor.web3.Connection(url, 'confirmed');
  const isDevnet = args.cluster !== 'localnet';

  // === Master wallet (priority: @file > SOLANA_PRIVATE_KEY > kicktick-deployer.json > generate) ===
  let master: Keypair;
  let masterLabel = '';

  if (args.keypairPath) {
    master = loadKeypair(args.keypairPath);
    masterLabel = args.keypairPath;
  } else if (process.env.SOLANA_PRIVATE_KEY) {
    const raw = process.env.SOLANA_PRIVATE_KEY.trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        master = Keypair.fromSecretKey(Uint8Array.from(parsed));
      } else {
        throw new Error('SOLANA_PRIVATE_KEY not a JSON array');
      }
    } catch {
      // try base58
      const bs58 = require('bs58');
      master = Keypair.fromSecretKey(bs58.decode(raw));
    }
    masterLabel = 'SOLANA_PRIVATE_KEY';
  } else {
    const masterPath = path.resolve(__dirname, '..', 'kicktick-deployer.json');
    if (fs.existsSync(masterPath)) {
      master = loadKeypair(masterPath);
      masterLabel = masterPath;
    } else {
      master = Keypair.generate();
      masterLabel = 'generated';
    }
  }
  console.log(`Master: ${master.publicKey.toBase58()} (${masterLabel})`);

  // === Create output dir ===
  fs.mkdirSync(args.outdir, { recursive: true });

  // === Generate wallets (resume from existing) ===
  const existing = fs.readdirSync(args.outdir)
    .filter(f => /^wallet-\d+\.json$/.test(f))
    .map(f => parseInt(f.match(/\d+/)![0], 10))
    .sort((a, b) => a - b);
  const startIdx = existing.length > 0 ? Math.max(...existing) : 0;

  console.log(`\nGenerating ${args.count} wallets (${startIdx} existing, need ${args.count - startIdx} new)...`);
  const wallets: Keypair[] = [];

  // load existing
  for (let i = 1; i <= Math.min(startIdx, args.count); i++) {
    const f = path.join(args.outdir, `wallet-${String(i).padStart(2, '0')}.json`);
    const raw = JSON.parse(fs.readFileSync(f, 'utf-8'));
    wallets.push(Keypair.fromSecretKey(Uint8Array.from(raw)));
  }

  // generate new
  for (let i = startIdx + 1; i <= args.count; i++) {
    const kp = Keypair.generate();
    wallets.push(kp);
    const filePath = path.join(args.outdir, `wallet-${String(i).padStart(2, '0')}.json`);
    fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  }

  // === Check master balance — only fund wallets that need SOL ===
  const targetLamports = args.solPerWallet * LAMPORTS_PER_SOL;
  const needFund: Keypair[] = [];
  for (const w of wallets) {
    const bal = await conn.getBalance(w.publicKey);
    if (bal < targetLamports * 0.99) needFund.push(w);
  }
  const needLamports = targetLamports * needFund.length;

  const masterBal = await conn.getBalance(master.publicKey);
  const masterNeed = Math.max(args.masterSol * LAMPORTS_PER_SOL, needLamports + 0.01 * LAMPORTS_PER_SOL);
  const shortfall = masterNeed - masterBal;

  console.log(`Master balance: ${(masterBal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`${needFund.length}/${wallets.length} wallets need funding (${(needLamports / LAMPORTS_PER_SOL).toFixed(2)} SOL needed)`);

  if (isDevnet && masterBal < 0.01 * LAMPORTS_PER_SOL) {
    console.log(`\nAirdropping ${args.masterSol} SOL to master wallet...`);
    await airdropWithRetry(conn, master.publicKey, masterNeed, 'master');
  } else if (isDevnet && shortfall > 0) {
    const airdropAmt = Math.min(masterNeed - masterBal, 5 * LAMPORTS_PER_SOL);
    console.log(`Shortfall ${(shortfall / LAMPORTS_PER_SOL).toFixed(2)} SOL, airdropping ${(airdropAmt / LAMPORTS_PER_SOL).toFixed(2)}...`);
    await airdropWithRetry(conn, master.publicKey, airdropAmt, 'top-up');
  } else if (!isDevnet) {
    console.log(`Localnet: airdropping master...`);
    await airdropWithRetry(conn, master.publicKey, masterNeed, 'localnet');
  }

  // === Save generated master keypair ===
  if (masterLabel === 'generated') {
    const out = path.join(args.outdir, 'master.json');
    fs.writeFileSync(out, JSON.stringify(Array.from(master.secretKey)));
    console.log(`Saved master keypair to ${out}`);
  }

  // === Distribute via transfer (one tx per wallet for reliability) ===
  console.log(`\nDistributing ${args.solPerWallet} SOL to ${needFund.length} wallets...`);
  const results: { idx: number; pk: string; ok: boolean; bal: number }[] = [];

  for (let n = 0; n < needFund.length; n++) {
    const w = needFund[n];
    const idx = wallets.indexOf(w) + 1;
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: master.publicKey,
      toPubkey: w.publicKey,
      lamports: targetLamports,
    }));

    let ok = false;
    for (let retry = 0; retry < 5; retry++) {
      try {
        await sendAndConfirmTransaction(conn, tx, [master], { commitment: 'confirmed' });
        ok = true;
        break;
      } catch (e: any) {
        const msg = e.message ?? String(e);
        if (msg.includes('429') && retry < 4) {
          const delay = Math.min(2000 * (2 ** retry), 30000);
          console.log(`  429 wallet-${idx}, retry ${retry+1}/5 in ${delay}ms`);
          await sleep(delay);
          continue;
        }
        console.log(`  wallet-${idx} fail: ${msg.slice(0, 80)}`);
        break;
      }
    }

    const bal = await conn.getBalance(w.publicKey);
    results.push({ idx, pk: w.publicKey.toBase58(), ok, bal });
    if (ok) {
      console.log(`  wallet-${String(idx).padStart(2, '0')}  ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }
  }

  // collect balances for wallets that didn't need funding
  for (const w of wallets) {
    const idx = wallets.indexOf(w) + 1;
    if (!needFund.includes(w)) {
      const bal = await conn.getBalance(w.publicKey);
      results.push({ idx, pk: w.publicKey.toBase58(), ok: true, bal });
    }
  }
  results.sort((a, b) => a.idx - b.idx);

  // === Summary ===
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Wallets Directory: ${args.outdir}`);
  console.log(`Cluster: ${url}`);
  console.log(`Master Wallet: ${master.publicKey.toBase58()}`);
  console.log(`${'='.repeat(80)}`);
  console.log(` #  | Address                                        | Balance     | Status`);
  console.log(`-`.repeat(80));
  for (const r of results) {
    console.log(`${String(r.idx).padStart(2)}  | ${r.pk} | ${(r.bal / LAMPORTS_PER_SOL).toFixed(4)} SOL | ${r.ok ? 'OK' : 'FAIL'}`);
  }
  console.log(`-`.repeat(80));
  const ok = results.filter(r => r.ok).length;
  console.log(`${ok}/${results.length} wallets funded`);

  // === Print PK list for copy-paste into scripts ===
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Public keys for scripts:`);
  console.log(`const PRIV_KEYS_B58 = [`);
  for (const w of wallets) {
    const bs58 = require('bs58');
    console.log(`  '${bs58.encode(Buffer.from(w.secretKey))}',`);
  }
  console.log(`];`);

  if (!isDevnet) {
    console.log(`\nLocalnet: to reuse same wallets, add --cluster localnet next time`);
  }

  if (ok !== results.length) {
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
