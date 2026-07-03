# KickTick — Agent Navigation Map

> **Hackathon:** World Cup Hackathon — Superteam × Solana, powered by TxODDS
> **Track:** Prediction Markets & Settlement ($18k USDT)
> **Deadline:** July 19, 2026
> **Phase 0:** ✅ Completed July 3, 2026

---

## Project DNA

Sub-minute micro prediction markets on Solana. Create + settle markets in <60s using live TxODDS oracle odds + on-chain Merkle proof settlement.

---

## Quick Start for Agents

```
docs/agent/
├── AGENTS.md            ← this file — entry point
├── STRUCTURE.md         ← every file with description (50+ files)
├── ARCHITECTURE.md      ← component diagram, data flow, sequence
├── CONSTANTS.md         ← program IDs, PDAs/seeds, tokens, configs
├── INSTRUCTIONS.md      ← 6 on-chain instructions: accounts, args, logic
├── WORKFLOWS.md         ← deploy, test, create market, settle, debug
├── DEPENDENCIES.md      ← module dep graph, tech stack with versions
└── ROADMAP.md           ← phases, status, risks, buffer
```

**Reading order for new agents:** AGENTS.md → STRUCTURE.md → CONSTANTS.md → INSTRUCTIONS.md → ARCHITECTURE.md

---

## Three Subsystems

| # | Subsystem | Dir | Language | Purpose |
|---|-----------|-----|----------|---------|
| 1 | **Anchor Program** | `kicktick/programs/kicktick/` | Rust (Anchor 1.0.0) | On-chain PDAs, CPI settlement, bet accounting |
| 2 | **Relayer** | `relayer/` | Node/TS | Off-chain crank: SSE ingestion, market triggers, proof gathering, tx builder |
| 3 | **Frontend** | `frontend/` | Next.js + React + Tailwind | UI with wallet, market cards, live odds |

Plus **TypeScript SDK** (`kicktick/client/src/`) — wraps Anchor program + TxODDS client.

---

## Key Files Quick Reference

### On-chain (Rust)
| File | Lines | Role |
|------|-------|------|
| `programs/kicktick/src/lib.rs` | 140 | Module router — wires 10 instructions, 5 state PDAs |

### TypeScript SDK
| File | Lines | Role |
|------|-------|------|
| `client/src/market-manager.ts` | 538 | KickTickManager class — createMarket, placeBet, settle, claim |
| `client/src/txodds-oracle.ts` | 499 | TxOddsClient — auth, SSE, snapshots; SpikeDetector; shouldSettleYes |

### Relayer
| File | Lines | Role |
|------|-------|------|
| `src/config.ts` | 45 | Env config loader (RPC, program IDs, tokens) |
| `src/txline-auth.ts` | 138 | Guest JWT + API token activation |
| `src/cpi-spike.ts` | 456 | CPI spike test — validate_stat feasibility |
| `src/verify-tokens.ts` | 75 | TxL + USDT mint verification on devnet |
| `src/index.ts` | 20 | Placeholder main loop |

### Frontend
| File | Lines | Role |
|------|-------|------|
| `components/Header.tsx` | - | Nav + wallet connect (Phantom/Solflare) |
| `components/MarketCard.tsx` | - | Market display, bet buttons, countdown |
| `components/CreateMarketModal.tsx` | - | 2-step market creation modal |
| `components/LiveOddsFeed.tsx` | 90 | Simulated live odds feed |
| `lib/constants.ts` | 30 | Program IDs, network config |
| `lib/WalletContext.tsx` | - | Solana wallet adapter provider |

### Tests & Scripts
| File | Lines | Role |
|------|-------|------|
| `kicktick/tests/kicktick.ts` | 208 | Native SOL tests: init → match → round → bet → settle → claim |
| `scripts/txline-test.ts` | 238 | Full TxLINE API integration test |
| `simulation.ts` | 204 | SpikeDetector + shouldSettleYes simulation |
| `simulation.js` | 122 | Standalone JS simulation |

### Docs
| File | Lines | Role |
|------|-------|------|
| `docs/KickTick-Architecture.md` | 455 | System architecture with ASCII diagrams |
| `docs/KickTick-MVP-Plan.md` | 799 | Detailed MVP plan, CPI spec, all market rules |
| `KickTick-Backend-Roadmap.md` | 259 | Phased roadmap with task list |

---

## Network Config (Devnet)

| Component | Address |
|-----------|---------|
| KickTick program | `CCmcpUZttSJqUabxBcyvHp4uC89EkrXce5YSEvRgE7tc` |
| TxOracle program | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| TxL mint (Token-2022) | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| USDT mint (Token) | `ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh` |
| RPC | `https://api.devnet.solana.com` |
| TxLINE API | `https://txline-dev.txodds.com` |

---

## Command Cheat Sheet

```bash
# Anchor
anchor build                          # Build program
anchor deploy --provider.cluster devnet  # Deploy to devnet
anchor test                           # Run tests

# Relayer
cd relayer && npx ts-node src/cpi-spike.ts  # Run CPI spike test
cd relayer && npx ts-node src/verify-tokens.ts  # Check token mints

# Client SDK
cd kicktick/client && npx ts-node src/txodds-oracle.ts  # Test TxODDS client

# Scripts
cd scripts && npx ts-node txline-test.ts  # Full TxLINE integration test
npx ts-node simulation.ts               # Run simulation

# Frontend
cd frontend && npm run dev              # Dev server
```

---

## Git Branch

`feat/backend` — 12 commits, Phase 0 completed.
