---
id: relayer-architecture
type: architecture
title: "Relayer Architecture"
service: relayer
depends_on:
  - relayer-readme
related_to:
  - relayer-streams
  - relayer-triggers
  - relayer-settlement
  - relayer-api
  - integration-data-flow
tags: [relayer, clob, data-flow, recovery]
---

# Relayer Architecture

The relayer is a single process composed from CLOB application services,
TxLINE integration, Solana settlement, and a WebSocket transport. SQLite is
the durable local source of truth for orders, fills, markets, cursors, and
lifecycle intents. Solana is authoritative for confirmed collateral, shares,
market state, and fill sequence.

## Module dependency graph

```text
index.ts
├── config.ts                 env/config bootstrap
├── clob/store.ts             SQLite persistence
├── clob/matching-engine.ts   price-time matching
├── clob/settlement.ts        serialized fill submission
├── clob/recovery.ts          restart reconciliation
├── clob/lifecycle.ts         intake freeze and locking
├── clob/ws-api.ts            wallet-authenticated CLOB protocol
├── clients/txline-client.ts  TxLINE REST/SSE integration
├── clients/txline-auth.ts    guest/API-token provisioning
├── clients/anchor-client.ts  Anchor IDL and Solana transactions
├── infrastructure/txline/   raw score mapping
├── domain/football/           normalized football events and state
├── market/fixture-watcher.ts  fixture reduction
├── market/triggers.ts         MarketCommand generation
├── market/action-executor.ts  durable lifecycle orchestration
├── settlement/proof-gatherer.ts  TxLINE proof retrieval
├── settlement/crank.ts        proof/market transaction execution
├── api/ws-server.ts           WebSocket transport and subscriptions
└── api/test-controller.ts     TEST_MODE-only synthetic control plane
```

## Startup and recovery sequence

```text
1. loadConfig()
2. construct WebSocket, TxLINE, Anchor, and SQLite services
3. recover CLOB orders, books, fills, cursors, and markets
4. reconcile pending market lifecycle actions with Solana
5. restore fixture/market state into FixtureWatcher and MarketTrigger
6. authenticate TxLINE and provision an API token when needed
7. register TestController only when TEST_MODE=true
8. start the WebSocket server
9. load configured fixtures and start score/odds streams
10. run cron windows and the 5-second timeout/recovery scheduler
```

Recovery is scoped per market so one bad account does not prevent unrelated
markets from being restored. Deferred recovery is logged and retried by the
runtime where supported.

## Event processing pipeline

```text
TxLINE SSE / replay payload
  → clients/txline-client.ts
  → infrastructure/txline/score-mapper.ts
  → domain/football/event-parser.ts
  → market/fixture-watcher.ts
  → market/triggers.ts
  → market/action-executor.ts
       ├─ clob/lifecycle.ts
       ├─ clob/settlement.ts
       └─ settlement/crank.ts → clients/anchor-client.ts
  → api/ws-server.ts
```

The score mapper owns raw PascalCase/camelCase compatibility. The domain
parser emits normalized `FootballEvent` values. Triggers emit `MarketCommand`
values from `src/domain/markets.ts`; the executor persists intent and performs
idempotent lifecycle work.

## Market commands

```text
open_market
resolve_market_onchain
resolve_market_offchain
confirm_market
```

The crank may expose `settle_onchain` and `settle_offchain` as status labels for
backward-compatible WebSocket transaction reporting. They are not domain
commands and must not be used as new trigger action names.

## Connection lifecycle

```text
TxLINE authentication → SSE streaming → heartbeat/reconnect
                                └→ monotonic cursor + replay normalization
```

The WebSocket server is independent of the TxLINE connection and can continue
to publish durable CLOB state while the upstream stream reconnects.

## Durable recovery model

- SQLite stores signed orders, fills, nonces, markets, fixture cursors, and
  pending lifecycle actions.
- Solana is checked before retrying ambiguous fill or lifecycle work.
- Fill reconciliation compares transaction status with on-chain
  `Market.fill_sequence`.
- An ambiguous transaction keeps its reservation until chain state proves the
  fill failed.
- Local lifecycle state is not advanced before the corresponding on-chain
  transition is confirmed.

## Current reliability boundaries

This is a devnet/MVP relayer. Known hardening items include pre-trade on-chain
collateral validation, chain-based reconciliation for all ambiguous
transactions, proof-sequence durability across timeout/reconnect paths, and
waiting for asynchronous work before a test reset completes.
