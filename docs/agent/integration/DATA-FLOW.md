---
id: integration-data-flow
type: architecture
title: "End-to-End Data Flow"
service: integration
depends_on:
  - overview-architecture
related_to:
  - program-instructions
  - relayer-readme
tags: [data-flow, SSE, CPI, WebSocket]
---

# End-to-End Data Flow

## System Diagram

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
│   init_market        │       │ CreateMarketModal     │
│   lock_market        │       │ Live orderbook        │
│   resolve_market_*   │       │                       │
│   confirm_market     │       │ Wallet: Phantom/Solflare│
│   claim / withdraw   │       │                       │
│ txoracle program     │       │ CLOB data, not demo   │
│   validate_stat (CPI)│       │                       │
└──────────────────────┘       └──────────────────────┘
```

## Data Flow Steps

1. **Auth:** Relayer authenticates with TxLINE API → JWT + API token
2. **SSE Subscribe:** Relayer connects to SSE streams (scores + odds)
3. **Event Parse:** SSE events trigger market rules. An event that determines
   an open market's outcome first stops CLOB intake and locks the market; the
   relayer then resolves it. Markets with no determining event stay open until
   their deadline.
4. **Proof Fetch:** Relayer fetches Merkle proof from `/api/scores/stat-validation`
5. **Crank:** Relayer builds Solana transaction, signs with keypair, sends to devnet
6. **CPI:** `resolve_market_with_proof` instruction calls `txoracle::validate_stat` with proof accounts
7. **WebSocket:** Relayer pushes market status updates to frontend
8. **Frontend:** User sees live market state, places bets via wallet

## SSE Event Types (TxLINE Soccer Feed)

Key actions that drive market triggers:

| Event | Market Action |
|-------|---------------|
| `goal` | Close NextGoalSide, open new one |
| `corner` | Close NextCorner, open new one |
| `yellow_card` | Close NextYellowCard, open new one |
| `red_card` | Settle RedCardInMatch (YES) |
| `penalty` | Open PenaltyShot |
| `penalty_outcome` {Scored/Missed/Retake} | Settle or extend |
| `var` / `var_end` | Open/settle VARCheck |
| `status` {StatusId} | Phase transitions (HT, ET, PE, F) |
| `possible` | Pre-market triggers (future use) |

## Match Phases

```
NS(1) → H1(2) → HT(3) → H2(4) → F(5) → WET(6) → ET(7-10) → WPE(11) → PE(12) → FPE(13)
```

- **NS:** Not Started
- **H1:** First Half
- **HT:** Half Time
- **H2:** Second Half
- **F:** Full Time
- **WET:** Wait Extra Time
- **ET:** Extra Time
- **WPE:** Wait Penalty Shootout
- **PE:** Penalty Shootout
- **FPE:** Final (after penalties)

## Related Docs

- `program/README.md` — Anchor program instructions
- `relayer/README.md` — relayer overview
- `relayer/ARCHITECTURE.md` — full module architecture
- `relayer/STREAMS.md` — SSE streams and auth
- `relayer/TRIGGERS.md` — market trigger rules
- `relayer/SETTLEMENT.md` — proof gathering and crank
- `integration/ENVIRONMENT.md` — network endpoints

## Reliability boundaries

The relayer persists local intent in SQLite, but Solana is authoritative for market status, collateral, positions, and CLOB fill sequence. A restart must therefore reconcile both sources before retrying a transaction.

For on-chain settlement, the sequence passed to `/stat-validation` is the upstream TxLINE score sequence. It is not the local market sequence. `PenaltyShot` and `VARCheck` intentionally use `resolve_market_offchain` and never enter the proof pipeline.

Match-specific WebSocket events are scoped by `fixtureId`; system health and general errors are global. CLOB market/orderbook updates are scoped by market subscription.
