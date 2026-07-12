---
id: overview-architecture
type: architecture
title: "System Architecture"
service: overview
depends_on:
  - overview-project
related_to:
  - program-architecture
  - integration-data-flow
tags: [architecture, data-flow, components]
---

# KickTick — System Architecture

> Three subsystems: Anchor program (on-chain) ↔ Relayer (off-chain crank) ↔ Frontend (Next.js)

---

## Data Flow

```
                         TxLINE API (txline-dev.txodds.com)
                      ┌──────────────────────────────────┐
                      │  POST /auth/guest/start → JWT     │
                      │  POST /api/token/activate         │
                      │  GET  /api/odds/snapshot/{id}     │
                      │  GET  /api/scores/stat-validation │
                      │  GET  /api/odds/stream (SSE)      │
                      │  GET  /api/scores/stream (SSE)    │
                      └─────────────┬────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────┐
│  RELAYER (Node/TS crank + durable SQLite CLOB)             │
│                                                             │
│  txline-auth.ts ──► txodds-client SDK ──► JWT + API token  │
│                                                             │
│  Wallet WebSocket ──► signed orders ──► SQLite CLOB         │
│  SSE scores stream ──► fixture-watcher (StatusId 1-19)     │
│       │                                                     │
│       ▼                                                     │
│  market-trigger.ts (rules engine)                           │
│    • Event-triggered: goal→lock/resolve NextGoalSide        │
│    • Cron: every 5min→GoalInWindow                          │
│    • Shootout mode: PE status→sequential CLOB markets       │
│    • Timeouts: deadline→drain fills, lock, resolve, confirm │
│       │                                                     │
│       ├──► proof-gatherer (GET /stat-validation)            │
│       │       │                                             │
│       │       ▼                                             │
│       │   crank.ts (build tx → sign → send to devnet)     │
│       │       │                                             │
│       └──► ws-server.ts (WebSocket → frontend)             │
└──────────┬────────────────────────────────────────────────┘
           │ CPI validate_stat               │ WebSocket
           ▼                                 ▼
┌──────────────────────┐       ┌──────────────────────┐
│ Solana Devnet        │       │ Frontend (Next.js)    │
│                      │       │                       │
│ kicktick program     │       │ Header (wallet)       │
│   init_config        │       │ CLOB market board     │
│   init_market        │       │ Live market board     │
│   lock_market        │       │ Orderbook + trading   │
│   resolve_market_*   │       │                       │
│   confirm_market     │       │ Wallet: Phantom/Solflare│
│   claim / withdraw   │       │                       │
│ txoracle program     │       │ CLOB data, not demo   │
│   validate_stat (CPI)│       │                       │
└──────────────────────┘       └──────────────────────┘
```

---

## Component Responsibilities

### Anchor Program (trustless, on-chain)
- Market lifecycle (Open → Locked → ResolvedPending → Resolved/Voided)
- Markets stay `Open` while their outcome is still uncertain. The relayer locks
  immediately when an SSE event makes the outcome determinable, or after
  `expires_at` when the event did not occur.
- SPL USDC custody in UserVault and MarketVault token accounts
- Position tracking per user per market
- Settlement via CPI `txoracle::validate_stat` or off-chain relayer
- Instructions: `init_config`, `init_market`, `init_user`, `deposit`, `withdraw`, `confirm_market`, `resolve_market_with_proof`, `resolve_market_offchain`, `close_market_vault`, `claim`, `cleanup_position`, `set_relayer`
- **Current:** CLOB-native market model with SQLite-backed relayer state

### Relayer (off-chain crank, trusted for MVP)
- SQLite-backed CLOB order, fill, and market persistence with wallet-authenticated WebSocket sessions; no REST trading API
- SSE consumer: parses live match actions (goal, corner, card, VAR)
- Market trigger rules: opens, locks, resolves, and confirms CLOB markets based on match events
- Proof gatherer: fetches Merkle proofs from TxLINE REST
- Crank: builds and sends Solana transactions
- WebSocket: pushes market and orderbook statuses to frontend

### Frontend (Next.js)
- Wallet connection (Phantom, Solflare)
- Live binary market browsing, orderbook trading, portfolio, and claims
- Wallet-authenticated BUY and SELL order submission through the relayer
- Development-only market and test-wallet controls under the admin route
