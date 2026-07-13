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
index.ts                         fatal-error boundary only
└── app/relayer-runtime.ts       startup and top-level orchestration
    ├── app/bootstrap.ts         dependency construction without external work
    ├── app/fixture-runtime.ts   fixture loading and Match reconciliation
    ├── app/scheduler.ts         timeout, cleanup, cron, and status timers
    ├── app/shutdown.ts          ordered signal handling and resource closure
    ├── clob/store.ts            SQLite persistence
    ├── clob/matching-engine.ts  price-time matching
    ├── clob/settlement.ts       per-market serialized fill submission
    ├── clob/recovery.ts         order/fill restart reconciliation
    ├── clob/cleanup.ts          durable expiry and post-lock cancellation
    ├── clob/lifecycle.ts        intake freeze and locking
    ├── clob/ws-api.ts           wallet-authenticated CLOB protocol
    ├── clients/txline-client.ts TxLINE REST/SSE integration
    ├── clients/txline-auth.ts   guest/API-token provisioning
    ├── clients/anchor-client.ts compatibility facade for Solana capabilities
    ├── infrastructure/solana/   context, PDAs, readers, gateways, type mapping
    ├── infrastructure/txline/   raw score-event mapping
    ├── domain/                  transport-independent market and football types
    ├── market/                  fixture reduction, triggers, durable actions
    ├── settlement/              proof gathering and market-resolution crank
    └── api/                     WebSocket transport and dev test controller
```

`clients/anchor-client.ts` remains the public compatibility facade used by the
runtime. Provider construction, account reads, PDA derivation, lifecycle
transactions, fill settlement, error extraction, and Anchor boundary mapping
are owned by focused modules under `infrastructure/solana/`.

## Startup and recovery sequence

```text
1. `loadConfig()` from repository and relayer environment files.
2. Construct transport, TxLINE, Solana, SQLite, CLOB, and settlement services.
3. Recover CLOB orders/fills and process durable cleanup intents.
4. Reconcile markets left in `LOCKING` and pending lifecycle actions with Solana.
5. Reconcile on-chain Match accounts and restore fixture cursors/market trackers.
6. Authenticate TxLINE and provision an API token when needed.
7. Register `TestController` when `TEST_MODE=true` or `NODE_ENV=development`.
8. Start the WebSocket server, load fixtures, and start score/odds SSE streams.
9. Start timeout/recovery and cleanup jobs every 5 seconds, cron checks every
   60 seconds, and system status broadcasts every 30 seconds.
```

The current runtime always executes this full sequence; test mode only adds the
synthetic control plane. Recovery is scoped per market so one bad account does
not prevent unrelated markets from being restored. Deferred recovery is logged
and retried by the runtime where supported.

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
                                   └─ infrastructure/solana/*
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

All relayer HTTP RPC traffic uses the shared throttled fetch adapter in
`clients/solana-rpc.ts`. `SOLANA_RPC_MIN_INTERVAL_MS` controls the minimum
interval between requests and defaults to 750 ms.

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
