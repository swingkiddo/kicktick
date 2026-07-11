---
id: frontend-readme
type: overview
title: "Frontend CLOB Client"
service: frontend
depends_on: [clob-architecture]
tags: [frontend, clob, wallet, websocket]
status: active
---

# Frontend CLOB Client

The Vite/React frontend is the wallet-facing CLOB terminal. It shows live markets and per-outcome depth, signs native-SOL limit orders and cancellations, restores private open orders after wallet authentication, and sends on-chain deposit, withdraw, and claim transactions through the generated Anchor IDL.

`src/lib/orders.ts` owns the exact canonical message format shared with the relayer. `src/lib/ClobProvider.tsx` handles reconnects, wallet challenge-response authentication, public orderbooks, private orders, fills, and positions. `src/lib/kicktickClient.ts` loads `/idl/kicktick.json` and derives user, vault, market, and position PDAs.

The wallet UI always requests `cancel_all` before a standard withdrawal. Market data is live from the relayer; it does not show demo pools or USDT balances.

Build with `./scripts/build.sh frontend`. Build contracts first after an IDL change so the script can copy `target/idl/kicktick.json` into `frontend/public/idl/`.

See [CLOB Architecture & Operations](../../CLOB.md) for the signed-message protocol, WebSocket commands, and recovery procedure.

When the relayer runs with `TEST_MODE=true`, the admin page exposes a dev-only test control panel. It signs the test-admin challenge with the connected contract-admin wallet and can create synthetic matches/markets and inject football events. JSON test keypairs remain outside the browser and are used by `./scripts/run.sh test-runner`.
