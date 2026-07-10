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

It also runs TxLINE market lifecycle handling: open market, freeze intake before expiry, drain matched fills, lock, resolve, confirm, and retain enough state to recover safely after a restart. SQLite persistence is required; the relayer is not an in-memory-only crank.

Use `CLOB_DB_PATH` to select the database location. `./scripts/run.sh relayer` persists the default database under `relayer/data/`. See [CLOB Architecture & Operations](../../CLOB.md) for the wire protocol, backup/recovery procedure, and trusted-relayer model.
