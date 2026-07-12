---
id: clob-architecture
type: architecture
title: "KickTick CLOB Architecture & Operations"
service: integration
tags: [clob, solana, sqlite, websocket, operations]
status: active
---

# KickTick Hybrid CLOB

KickTick uses configured SPL USDC collateral and a hybrid CLOB. Wallets deposit
USDC into program-controlled token vaults, sign GTC limit orders locally, and
send them to the relayer over WebSocket. The relayer verifies signatures,
stores authoritative open-order reservations in SQLite, matches price-time
priority in memory, then submits each fill to Solana in market sequence order.

The current trading path is binary-only. BUY orders reserve collateral with
ceil arithmetic; SELL orders lock shares. Complementary BUY orders can create
YES/NO complete sets, while ternary CLOB settlement is unsupported.

The configured relayer is trusted to validate signatures and submit fills. On-chain code remains authoritative for user balances, positions, market collateral, and `fillSequence`; a relayer never gets authority to withdraw a user's vault.

## Accounts and lifecycle

| Account | PDA seeds | Responsibility |
|---|---|---|
| Config | `config` | Admin, rotatable relayer, settlement configuration |
| UserAccount | `user`, owner | Available/reserved collateral bookkeeping |
| User vault | `user_vault`, owner | System-owned SOL custody vault |
| Market | `market`, fixture id, market type, sequence | Parameters, status, expiry, `fillSequence` |
| Market vault | `market_vault`, market | Fully collateralized complete-set funds |
| Position | `position`, market, owner | Outcome-share balances and claim state |

Market states are `OPEN → LOCKED → RESOLVED_PENDING → RESOLVED`; cancelled fixtures become `VOIDED`. Order intake ends two seconds before expiry. The relayer drains fills, locks the market, resolves it from TxOracle (or permitted off-chain VAR data), confirms finality, then users claim and withdraw.

Every on-chain fill supplies the market's next `fillSequence`. A retry that sees an already-consumed sequence is reconciled instead of being applied twice.

## Signed messages

All integer quantities are decimal strings. Prices are 100-bps ticks from 100 through 9900. The following exact UTF-8 bytes are signed; field order and the trailing newline are significant:

```text
kicktick-clob-order
version=1
network=devnet
program_id=<program>
market=<market PDA>
owner=<wallet>
side=BUY
outcome_index=0
price_bps=5000
quantity=100
nonce=123456
expires_at=1710000000

```

`order_id` is SHA-256 of those canonical bytes followed by the raw 64-byte Ed25519 signature. A cancellation is independently signed with the `kicktick-clob-cancellation` domain and fields `version`, `network`, `program_id`, `owner`, `order_id`, `nonce`, and `expires_at` in that order.

## WebSocket API

The relayer WebSocket is configured by `VITE_RELAYER_WS_URL` (or defaults to port 8080 on the current host). Authenticate after each reconnect:

1. Send `auth_challenge` with `{ owner }`.
2. Sign `kicktick-clob-auth\nowner=<owner>\nchallenge=<challenge>\n` from the server response.
3. Send `auth_response` with `{ owner, signature }`.

Public clients subscribe with `subscribe_market` and `subscribe_orderbook`, each carrying `{ market }`. They receive `market_update` and `orderbook`; the latter groups bid/ask levels by `outcome_index`. Authenticated clients receive `private_orders` after authentication and use `submit_order`, `cancel_order`, or `cancel_all`. Order transitions are `OPEN`, `PARTIAL`, `FILLED`, `CANCELLED`, `EXPIRED`, and `REJECTED`; fill transitions are `MATCHED`, `SUBMITTED`, `CONFIRMED`, and `FAILED`.

## SQLite durability and recovery

`CLOB_DB_PATH` names the SQLite database. It runs in WAL mode with migrations, foreign keys, and a busy timeout. It persists markets, signed orders, fills, nonce uniqueness, and schema migrations. On startup the relayer reloads open books and reconciles pending fills using on-chain `fillSequence` before accepting new fills.

`./scripts/run.sh relayer` mounts `relayer/data/` at `/app/data` and defaults `CLOB_DB_PATH` to `/app/data/kicktick-clob.sqlite`. The directory and database artifacts are ignored by Git.

To back up a stopped relayer, copy both `kicktick-clob.sqlite` and its `-wal`/`-shm` sidecars. For a live backup, use SQLite's backup mechanism from an operations container; do not copy a WAL database while writes are active. Restore all three files with the relayer stopped, then start it and inspect pending-fill reconciliation before allowing traffic.

## Build and launch

Run all service actions through the project scripts:

```bash
./scripts/build.sh contracts
./scripts/build.sh frontend
./scripts/build.sh relayer
./scripts/run.sh relayer -d
```

The build script copies the generated `kicktick/target/idl/kicktick.json` into both the relayer and frontend build contexts. Build contracts first whenever the program interface changes. The frontend fetches the copied IDL at `/idl/kicktick.json` and uses it for deposit, withdraw, and claim instructions.

## Operational checks

- Refuse user withdrawals until `cancel_all` is acknowledged; this prevents a newly invalid collateral balance from leaving stale open orders.
- If the UI reconnects, repeat wallet authentication and re-subscribe each market/orderbook; private open orders are restored by the relayer.
- A market stuck in `SUBMITTED` or `MATCHED` requires fill reconciliation, not a manual duplicate submission.
- Verify that a market's collateral equals complete-set supply before resolution. Do not close market vaults until all positions are cleaned up.
