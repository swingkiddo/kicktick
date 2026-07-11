---
id: operations-structure
type: reference
title: "Full Project Structure"
service: operations
depends_on: []
related_to:
  - overview-architecture
tags: [structure, files, tree]
---

# KickTick — Full Project Structure

> Every source file with purpose. Excludes `node_modules/`, `target/`, `build artifacts`.

---

## Root

| Path | Type | Purpose |
|------|------|---------|
| `README.md` | doc | Project overview, setup instructions |
| `KickTick-Backend-Roadmap.md` | doc | Deleted — superseded by `docs/agent/ROADMAP.md` |
| `opencode.json` | config | OpenCode MCP config: solanaMcp + pdf-reader |
| `skills-lock.json` | config | Caveman skills lockfile |
| `.env.example` | config | Environment variable template |
| `.gitignore` | config | Git ignore rules |
| `deploy.sh` | script | Solana deployment script |
| `setup-local.sh` | script | Local dev environment setup |
| `simulation.ts` | script | TS simulation (SpikeDetector + settlement logic, 204 lines) |
| `simulation.js` | script | Standalone JS simulation (122 lines) |

---

## `kicktick/` — Anchor Workspace

### Root config
| Path | Purpose |
|------|---------|
| `Anchor.toml` | Localnet/devnet cluster config, program ID `7Pc2ipKnDya7UKhQVQA2zdateaLpgHGQbyNt34R5dNF4` |
| `Cargo.toml` | Workspace root — Anchor 1.0.0, borsh |
| `Cargo.lock` | Dependency lock |
| `rust-toolchain.toml` | Rust 1.96.0 |

### `programs/kicktick/` — On-Chain Program
| Path | Lines | Purpose |
|------|-------|---------|
| `src/lib.rs` | — | Module router — wires the current Market/CLOB instruction surface |
| `src/constants.rs` | — | Seeds, limits, StatKeys, CPI discriminator |
| `src/errors.rs` | — | KickTickError definitions |
| `src/state/` | 6 files | Config, Match_, Market, Position, UserAccount, SponsorVault |
| `src/instructions/` | — | Config, match, market, user, trade, oracle, and redemption handlers |

#### Accounts
- `Config` — admin, relayer, TxOracle roots, compatibility settings
- `Match_` — fixture ID, teams, match status, retained aggregate fields
- `UserAccount` / `UserVault` — available and reserved user collateral
- `Market` — market type, sequence, lifecycle, collateral, volume, fill sequence
- `Position` — outcome shares, locked shares, claim state
- `MarketVault` — system-owned SOL vault per market
- `SponsorVault` — retained compatibility account

#### Instructions
`init_config`, `init_match`, `set_relayer`, `init_user`, `deposit`, `withdraw`,
`init_market`, `lock_market`, `resolve_market_offchain`,
`resolve_market_with_proof`, `confirm_market`, `void_market`,
`settle_complete_set_binary`, `settle_complete_set_ternary`,
`settle_share_trade`, `claim`, `cleanup_position`, and `close_market_vault`.

### `client/` — TypeScript SDK (removed)

The `client/` directory previously contained a TypeScript SDK (`market-manager.ts`, `txodds-oracle.ts`). These files have been removed. The directory now only contains `node_modules/` and no source code.

### `tests/`
| Path | Lines | Purpose |
|------|-------|---------|
| `kicktick.ts` | — | Config, user collateral, deposit and withdrawal tests |
| `market.ts` | — | Market lifecycle, resolution, confirmation and void tests |
| `standalone-validator.ts` | — | Multi-wallet deposits, complete sets and share trades |

---

## `relayer/` — Node/TS Crank Worker

| Path | Lines | Purpose |
|------|-------|---------|
| `package.json` | - | Dependencies: @swingkiddo/txodds-client, @solana/web3.js, dotenv |
| `tsconfig.json` | - | TS config |
| `.env.example` | - | Env template (JWT, API token, RPC, keypair, program IDs) |
| `src/config.ts` | 45 | `loadConfig()` — env-based config with defaults |
| `src/index.ts` | — | Runtime composition, recovery, streams, schedulers and shutdown |
| `src/clients/txline-auth.ts` | 138 | `authenticateGuest()`, `activateApiToken()`, `testConnection()` |
| `src/clients/txline-client.ts` | 185 | SSE scores/odds stream with reconnection |
| `src/clients/anchor-client.ts` | 426 | Solana Anchor tx builder |
| `src/domain/football/event-parser.ts` | — | Normalized score event → FootballEvent |
| `src/infrastructure/txline/score-mapper.ts` | — | Raw TxLINE payload normalization |
| `src/market/fixture-watcher.ts` | — | Match state reduction |
| `src/market/triggers.ts` | — | MarketCommand rules: event-triggered + cron windows |
| `src/market/action-executor.ts` | — | Durable lifecycle execution and recovery |
| `src/clob/` | — | Store, matching, lifecycle, settlement, recovery, WebSocket API |
| `src/settlement/proof-gatherer.ts` | 208 | Merkle proof fetcher from TxLINE |
| `src/settlement/crank.ts` | 284 | Build + send Solana txs with retry |
| `src/api/ws-server.ts` | — | WebSocket transport and fixture/market subscriptions |
| `src/api/test-controller.ts` | — | TEST_MODE-only synthetic match/market/event control |
| `src/scripts/cpi-spike.ts` | 456 | CPI spike test — validate_stat feasibility |
| `src/scripts/verify-tokens.ts` | 75 | TxL + USDT mint verification |

### `docs/agent/services/relayer/` — Agent Docs

| Path | Type | Content |
|------|------|---------|
| `README.md` | overview | Purpose, data flow, module structure, deps |
| `ARCHITECTURE.md` | architecture | Module dependency graph, startup sequence, event pipeline |
| `STREAMS.md` | reference | SSE streams, auth, 18 event types, reconnect, status phases |
| `TRIGGERS.md` | reference | Market trigger rules — event, cron, shootout, timeout |
| `SETTLEMENT.md` | reference | Proof gathering, crank, retry policy, tx building |
| `API.md` | reference | WebSocket protocol — messages, subscriptions |
| `BUILD.md` | howto | Build, run, scripts, env, debug |

---

## `frontend/` — Next.js UI

| Path | Purpose |
|------|---------|
| `package.json` | Next.js 14.2, React 18, Tailwind 3.4 |
| `next.config.js` | Next config |
| `tailwind.config.js` | Dark theme: navy (#0F1923), teal (#14B8A6), cyan (#06B6D4) |
| `postcss.config.js` | PostCSS config |
| `tsconfig.json` | TS config |
| `app/layout.tsx` | Root layout with WalletContextProvider |
| `app/page.tsx` | Landing page: 4 demo markets, stats bar, live odds sidebar |
| `app/globals.css` | Tailwind + custom CSS |
| `components/Header.tsx` | Nav header + wallet multi-button (Phantom/Solflare) |
| `components/MarketCard.tsx` | Market card: YES/NO pool bar, bet buttons, countdown timer |
| `components/CreateMarketModal.tsx` | 2-step modal: type selection + duration/details |
| `components/LiveOddsFeed.tsx` | Simulated real-time odds display (demo data only) |
| `lib/constants.ts` | Program IDs, network config, market settings |
| `lib/WalletContext.tsx` | Solana wallet adapter provider |

---

## `scripts/`

| Path | Lines | Purpose |
|------|-------|---------|
| `txline-test.ts` | 238 | Full TxLINE API test: faucet USDT, subscribe, auth, fetch fixtures + odds, stream 3 events, stat-validation for WC fixture IDs |
| `keypair.json` | - | Generated dev keypair |

---

## `docs/`

| Path | Lines | Purpose |
|------|-------|---------|
| `KickTick-Architecture.md` | 455 | Full architecture: ASCII diagrams, SSE events, match phases, market types, trigger rules, component trees |
| `KickTick-MVP-Plan.md` | 799 | Complete MVP spec: real TxODDS facts, CPI mechanics, all 15 instructions, PDA schema, settlement logic, week-by-week schedule, 14 risks |
| `txodds-soccer-feed-v1.0.pdf` | - | TxODDS soccer feed specification PDF |

---

---

## Project Totals

| Metric | Value |
|--------|-------|
| Source files (excl. generated) | ~50 |
| Rust (on-chain) | lib.rs 140 + state 5 + instructions 10 + constants 48 + errors 102 |
| TS (relayer) | 674 lines |
| TSX (frontend) | ~400 lines |
| Documentation | ~1,500 lines |
| Git commits | 12 (feat/backend branch) |
