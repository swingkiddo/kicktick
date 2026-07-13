---
id: relayer-readme
type: overview
title: "Relayer CLOB Service"
service: relayer
depends_on: [clob-architecture]
tags: [relayer, clob, sqlite, websocket]
status: active
---

# Relayer CLOB Service

The relayer is a durable single-writer CLOB service. It verifies wallet-signed orders, persists orders/fills/nonces/markets in SQLite, matches books with price-time priority, serializes settlement by market `fillSequence`, and broadcasts market/orderbook/order/fill updates over WebSocket.

It also runs TxLINE market lifecycle handling: open market, keep intake open
while the outcome is uncertain, freeze intake when an event determines the
outcome (or at deadline), drain matched fills, lock, resolve, confirm, and
retain enough state to recover safely after a restart. SQLite persistence is
required; the relayer is not an in-memory-only crank.

Use `CLOB_DB_PATH` to select the database location. `./scripts/run.sh relayer` persists the default database under `relayer/data/`. See [the WebSocket API](./API.md), [settlement and recovery](./SETTLEMENT.md), and [the architecture](./ARCHITECTURE.md) for the wire protocol, backup/recovery procedure, and trusted-relayer model.

The current CLOB intake and settlement path is binary-only. It decodes the
reserve-aware 118-byte Order PDA layout, reports ceil-based BUY reserves, and
submits complementary complete-set orders in YES/NO outcome order.

The current runtime always starts the full recovery, TxLINE authentication,
fixture ingestion, SSE, lifecycle, cleanup, and scheduler path. `TEST_MODE=true`
adds the synthetic development control plane without disabling those services.
`NODE_ENV=development` also enables that control plane. `CLOB_ONLY_MODE` is
retained only as an unused compatibility setting and is not consulted by the
current runtime.

The test control plane accepts commands without a test-admin signature when
`TEST_AUTH_REQUIRED=false`, which is the local development default. Set
`TEST_AUTH_REQUIRED=true` before exposing a development relayer beyond a
trusted local environment; the control plane must never be enabled in
production.

## Operational status

The current implementation is a devnet/MVP relayer. It supports the complete event-to-settlement path, durable SQLite lifecycle state, reconnect replay, CLOB matching, and match-scoped WebSocket broadcasts.

The following hardening work remains before treating it as production-safe:

- independently re-read UserAccount and Position state beyond the confirmed
  `create_order` transaction and validated Order PDA when additional pre-trade
  policy checks are introduced;
- reconcile ambiguous Solana transactions using signature status and on-chain `fillSequence` before retrying or releasing reservations;
- retry failed `open_market` actions when the on-chain account was never created;
- persist and validate the exact upstream proof sequence for timeout/reconnect settlement;
- make test reset wait for in-flight asynchronous actions.

These reliability items should be implemented incrementally after the current
devnet/UI smoke flow is verified.
