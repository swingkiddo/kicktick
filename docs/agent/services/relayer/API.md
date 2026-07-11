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

WebSocket server in `src/api/ws-server.ts`. Pushes market and match state to connected frontends.

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

---

## Server → Client Messages

## Dev test control plane

When `TEST_MODE=true`, the admin wallet can authenticate with `test_auth_challenge` / `test_auth_response`. The server accepts these commands only for the relayer/admin public key:

- `test_create_match` — `{ fixtureId, homeTeam, awayTeam }`
- `test_create_market` — `{ fixtureId, marketType, marketSeq, deadlineSeconds }`
- `test_emit_event` — `{ fixtureId, action, participant?, statusId?, outcome? }`
- `test_snapshot` — returns synthetic matches and SQLite markets
- `test_reset` — clears test CLOB orders, fills, nonces, and markets

The control plane uses the same Anchor client, SQLite CLOB, FixtureWatcher, MarketTrigger, lifecycle, and broadcasts as the live relayer. Do not enable it in production.

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

### Market Settled

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
