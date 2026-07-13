---
id: relayer-api
type: reference
title: "WebSocket API"
service: relayer
depends_on:
  - relayer-architecture
related_to:
  - relayer-settlement
tags: [websocket, api, protocol, messages]
---

# WebSocket API

## Overview

`src/api/ws-server.ts` provides the shared transport for fixture lifecycle
events and the wallet-authenticated CLOB adapter in `src/clob/ws-api.ts`.

**Default port:** 8080 (configurable via `WS_PORT` env var)

---

## Connection

```
ws://localhost:8080
```

On connect, server sends welcome message:

```json
{ "type": "welcome", "data": { "version": "0.1.0" } }
```

---

## Client → Server Messages

### Subscribe to Match

```json
{ "type": "subscribe_match", "data": { "fixtureId": 542179 } }
```

Subscribe to all events for a specific fixture. Server begins sending match-specific broadcasts to this client.

### Unsubscribe from Match

```json
{ "type": "unsubscribe_match", "data": { "fixtureId": 542179 } }
```

### Ping (Keepalive)

```json
{ "type": "ping" }
```

Server responds with:

```json
{ "type": "pong" }
```

### Wallet authentication

Private order state and trading commands use a wallet-authenticated session.
The client requests `auth_challenge` with its public key, signs the returned
60-second challenge, and replies with a Base64 detached Ed25519 signature:

```json
{ "type": "auth_challenge", "data": { "owner": "<wallet-public-key>" } }
```

The exact signed UTF-8 bytes are:

```text
kicktick-clob-auth
owner=<wallet-public-key>
challenge=<challenge>
```

```json
{
  "type": "auth_response",
  "data": { "owner": "<wallet-public-key>", "signature": "<base64>" }
}
```

Success returns `authenticated` followed by the wallet's `private_orders`
snapshot. Authentication is scoped to one WebSocket connection.

### Market and orderbook subscriptions

| Message | Data | Result |
|---|---|---|
| `subscribe_market` | `{ market }` | Subscribe and immediately receive `market_update` |
| `unsubscribe_market` | `{ market }` | Remove the market subscription |
| `subscribe_orderbook` | `{ market }` | Subscribe and immediately receive `orderbook` |

Orderbook snapshots contain `bids` and `asks` grouped by zero-based outcome
index. Bigint-backed quantities are encoded as decimal strings.

### Submit order

`submit_order` accepts a signed protocol-v1 order. The wallet must first submit
and confirm the matching on-chain `create_order` instruction; its transaction
signature and Order PDA are included in the relayer payload.

```json
{
  "type": "submit_order",
  "data": {
    "payload": {
      "version": 1,
      "network": "devnet",
      "program_id": "<kicktick-program>",
      "market": "<market-pda>",
      "owner": "<wallet-public-key>",
      "side": "BUY",
      "outcome_index": 0,
      "price_bps": 5000,
      "quantity": "1000000",
      "nonce": "1",
      "expires_at": 1712345678,
      "order_pda": "<order-pda>",
      "create_tx_signature": "<confirmed-solana-signature>"
    },
    "signature": "<base64-detached-signature>"
  }
}
```

The detached signature covers the canonical `kicktick-clob-order` bytes in the
exact field order defined by `src/clob/protocol.ts`, not arbitrary JSON
serialization. The relayer verifies the wallet signature, network/program
context, confirmed instruction accounts, and the Order PDA's owner, market,
side, outcome, price, quantity, and nonce fields before inserting the order.
The decoder expects the current 118-byte account layout.

Intake currently accepts binary markets only, prices from 100 to 9,900 bps in
100-bps ticks, quantities of at least 100 base units, and orders expiring no
later than the market. The relayer stops new intake two seconds before the
stored market deadline. Success returns `order_ack`; validation or chain
mismatch returns `order_rejected`. Matching then runs with price-time priority.

### Cancel order

Cancellation is also two-phase: the owner confirms `cancel_order` on chain,
then sends `cancel_order` with a signed `kicktick-clob-cancellation` payload
containing `order_id`, `order_pda`, and `cancel_tx_signature`. Success returns
`order_cancelled`.

`cancel_all` returns `CANCEL_ALL_UNSUPPORTED` because each Order PDA requires
its own confirmed on-chain cancellation.

The CLOB adapter accepts at most 30 handled messages per connection per second.
Excess traffic returns `RATE_LIMITED`; WebSocket frames are capped at 16 KiB.

---

## Server → Client Messages

The CLOB adapter emits `auth_challenge`, `authenticated`, `private_orders`,
`market_update`, `orderbook`, `order_ack`, `order_rejected`,
`order_cancelled`, and structured `error` messages. Order views include
original, filled, remaining, and pending quantities, ceil-based BUY
`reserved_cost`, and settlement status.

## Dev test control plane

When `TEST_MODE=true` or `NODE_ENV=development`, the relayer registers a
separate synthetic control plane. With `TEST_AUTH_REQUIRED=true`, the relayer
wallet must authenticate through `test_auth_challenge` and
`test_auth_response`; the challenge endpoint accepts only the configured
relayer public key. With `TEST_AUTH_REQUIRED=false`, control commands bypass
the signature gate. This bypass is intended only for trusted local development.

- `test_create_match` — `{ fixtureId, homeTeam, awayTeam }`
- `test_create_market` — `{ fixtureId, marketType, marketSeq, deadlineSeconds }`
- `test_emit_event` — `{ fixtureId, action, participant?, statusId?, outcome? }`
- `test_snapshot` — returns synthetic matches and SQLite markets
- `test_reset` — clears test CLOB orders, fills, nonces, and markets

The control plane uses the same Anchor client, SQLite CLOB, FixtureWatcher, MarketTrigger, lifecycle, and broadcasts as the live relayer. Do not enable it in production.

Injected events use the domain metadata envelope: fixture ID, synthetic TxLINE
sequence, occurrence time, current game state, and stable source message ID. A
`var_end` event must explicitly use `outcome: "Overturned"` or
`outcome: "Stands"`; other values are rejected.

Run the JSON-wallet order runner in Docker. `TEST_MARKET` is required; wallet
names are resolved from the read-only directory mounted by `run.sh`:

```bash
TEST_MARKET=<market-pda> \
TEST_WALLETS=wallet-01.json,wallet-02.json \
./scripts/run.sh test-runner
```

When using `run.sh`, provide these variables through `relayer/.env` or another
environment file consumed by the container. The runner sets
`TEST_WALLETS_DIR=/app/test-wallets` and does not copy private keys into the
container image.

### Match State Update

```json
{
  "type": "match_state",
  "data": {
    "fixtureId": 542179,
    "status": "FirstHalf",
    "homeScore": 1,
    "awayScore": 0,
    "currentPeriod": "H1",
    "matchClockMs": 2700000
  }
}
```

Sent on goal, score adjustment, status change.

### Market Opened

```json
{
  "type": "market_opened",
  "data": {
    "fixtureId": 542179,
    "marketSeq": 3,
    "marketType": "NextGoalSide",
    "lockSeconds": 30,
    "deadlineSeconds": 90,
    "expiresAt": 1712345678000
  }
}
```

### Market Resolved

```json
{
  "type": "market_resolved",
  "data": {
    "fixtureId": 542179,
    "marketSeq": 3,
    "outcome": "Yes",
    "txSig": "5KtPn2..."
  }
}
```

### Market Confirmed

```json
{
  "type": "market_confirmed",
  "data": {
    "fixtureId": 542179,
    "marketSeq": 3,
    "txSig": "5KtPn2..."
  }
}
```

### Market Cancelled

```json
{
  "type": "market_cancelled",
  "data": {
    "fixtureId": 542179,
    "marketSeq": 3
  }
}
```

### Football Event

```json
{
  "type": "football_event",
  "data": {
    "action": "goal",
    "fixtureId": 542179,
    "participant": 1,
    "description": "goal"
  }
}
```

Raw event broadcast to subscribers of that fixture.

Match state, football events, market lifecycle notifications, and fixture-specific transaction statuses are routed only to clients subscribed to the corresponding fixture. Global broadcasts are reserved for `system_status` and general error/status diagnostics. CLOB market and orderbook messages are routed only to clients subscribed to that market.

### Tx Status

```json
{
  "type": "tx_status",
  "data": {
    "fixtureId": 542179,
    "marketSeq": 3,
    "status": "confirmed",
    "txSig": "5KtPn2...",
    "error": null
  }
}
```

### Error

```json
{
  "type": "error",
  "data": { "message": "Something went wrong" }
}
```

---

## Subscription Model

```
Client A                     WebSocket Server               Client B
  │                              │                              │
  ├── subscribe_match(542179) ──►│                              │
  │                              │◄── subscribe_match(542179) ──┤
  │                              │                              │
  │               match event    │                              │
  │◄── broadcastToMatch(542179) ─┼──► broadcastToMatch(542179)  │
  │                              │                              │
  │                              │                              │
  ├── unsubscribe_match(542179)─►│                              │
```

- Clients subscribed to a match receive only that match's events
- Global broadcasts (`broadcast`) go to ALL connected clients
- Heartbeat: server pings every 30s, terminates unresponsive clients after 10s

---

## Implementation Details

```typescript
class WsServer extends EventEmitter {
  start(): void;                          // listen on configured port
  stop(): void;                           // cleanup + close
  broadcast(msg: WsServerMessage): void;  // all clients
  broadcastToMatch(fixtureId: number, msg: WsServerMessage): void; // per-match

  // Events
  on("connection", (ws: WebSocket) => void);
  on("message", (msg: WsClientMessage) => void);
  on("subscribe", (fixtureId: number) => void);
  on("unsubscribe", (fixtureId: number) => void);
}
```
