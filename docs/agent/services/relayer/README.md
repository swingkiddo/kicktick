---
id: relayer-readme
type: overview
title: "Relayer Overview"
service: relayer
depends_on:
  - overview-architecture
related_to:
  - program-readme
  - integration-data-flow
tags: [relayer, overview, crank]
status: stub
---

# Relayer Overview

## Purpose

Off-chain crank for KickTick. No database, no REST API, no user sessions.

Responsibilities:
- **SSE consumer** — parses live match actions from TxLINE (goal, corner, card, VAR, status)
- **Market trigger rules** — opens/closes rounds based on match events
- **Proof gatherer** — fetches Merkle proofs from TxLINE REST for CPI settlement
- **Crank** — builds and sends Solana transactions to devnet
- **WebSocket** — pushes round statuses to frontend

## Current State

### Phase 0 (Completed July 3, 2026)
- TxLINE authentication flow (guest JWT + API token)
- CPI spike test (validate_stat feasibility)
- Token mint verification (TxL + USDT on devnet)

### Phase 2 (Pending)
- SSE parser for scores/odds streams
- Fixture watcher (StatusId tracking)
- Market trigger rules engine
- Proof gatherer (Merkle proof fetcher)
- Crank (transaction builder)
- WebSocket server (frontend push)

## Module List

| File | Lines | Purpose |
|------|-------|---------|
| `src/config.ts` | 45 | Env config loader (RPC, program IDs, tokens) |
| `src/txline-auth.ts` | 138 | Guest JWT + API token activation |
| `src/cpi-spike.ts` | 456 | CPI spike test — validate_stat feasibility |
| `src/verify-tokens.ts` | 75 | TxL + USDT mint verification on devnet |
| `src/index.ts` | 20 | Placeholder main loop |

## TxLINE Auth Flow

```
1. POST /auth/guest/start  →  JWT
2. POST /api/token/activate (with signed message)  →  API token
3. All subsequent requests:
   Header "Authorization: Bearer <JWT>"
   Header "X-Api-Token: <API_TOKEN>"
```

Implemented in `src/txline-auth.ts` using `@swingkiddo/txodds-client` SDK.

## Running Scripts

```bash
cd relayer

# Set env vars
export TXLINE_JWT=<your_jwt>
export TXLINE_API_TOKEN=<your_token>

# CPI spike test
npx ts-node src/cpi-spike.ts

# Token verification
npx ts-node src/verify-tokens.ts
```

## Planned Architecture

```
SSE scores stream → fixture-watcher (StatusId 1-19)
     │
     ▼
market-trigger.ts (rules engine)
  • Event-triggered: goal→NextGoalSide, corner→NextCorner
  • Cron: every 5min→GoalInWindow
  • Shootout mode: PE status→sequential rounds
  • Timeouts: deadline→settle(NO)
     │
     ├──► proof-gatherer (GET /stat-validation)
     │       │
     │       ▼
     │   crank.ts (build tx → sign → send to devnet)
     │
     └──► ws-server.ts (WebSocket → frontend)
```

## Dependencies

- `@swingkiddo/txodds-client` — TxLINE API wrapper
- `@solana/web3.js` — Solana RPC interaction
- `dotenv` — environment config

## Related Docs

- `integration/DATA-FLOW.md` — end-to-end data flow diagram
- `integration/ENVIRONMENT.md` — environment variables, network endpoints
- `program/README.md` — Anchor program instructions
