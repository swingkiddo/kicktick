---
id: relayer-build
type: howto
title: "Build, Run & Scripts"
service: relayer
depends_on:
  - relayer-readme
related_to:
  - relayer-streams
  - integration-environment
tags: [build, run, scripts, docker, dev]
---

# Build, Run & Scripts

All service builds and runtime launches use the repository scripts. Host-side
execution is not the supported operational path.

## Build and run

```bash
./scripts/build.sh relayer
./scripts/run.sh relayer
```

Run detached when the frontend will be started separately:

```bash
./scripts/run.sh relayer -d
```

The default container is `kicktick-relayer` and listens on port `8080`. SQLite
is persisted under `relayer/data/` unless `CLOB_DB_PATH` is overridden.

Run tests inside the running container:

```bash
docker exec -it kicktick-relayer npm test
```

The host-side `npm run dev`, `npm run build`, and `npm run start` commands are
debugging internals, not the supported project workflow.

## Environment

The relayer loads the repository `.env` first and `relayer/.env` as an override.

```text
TXLINE_JWT=
TXLINE_API_TOKEN=
TXLINE_API_HOST=https://txline-dev.txodds.com
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_KEYPAIR_PATH=~/.config/solana/id.json
KICKTICK_PROGRAM_ID=LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND
TXORACLE_PROGRAM_ID=6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
COLLATERAL_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
WS_PORT=8080
CLOB_DB_PATH=/app/data/kicktick-clob.sqlite
TEST_MODE=false
CLOB_ONLY_MODE=
```

The private key may also be supplied as `SOLANA_PRIVATE_KEY` in hex. Never
commit either key form.

`TEST_MODE=true` enables the development control plane and, unless explicitly
overridden, CLOB-only startup. Set `CLOB_ONLY_MODE=false` to exercise full
TxLINE authentication, ingestion, recovery, and scheduled jobs while retaining
development test controls.

## IDL flow

The contracts build produces:

```text
kicktick/target/idl/kicktick.json
```

`./scripts/build.sh relayer` copies it to:

```text
relayer/src/idl/kicktick.json
```

`src/clients/anchor-client.ts` loads the copied file at runtime and overrides
its address with the configured KickTick program ID.

## Diagnostic scripts

Run these inside the relayer container when needed:

```bash
docker exec -it kicktick-relayer npx ts-node src/scripts/cpi-spike.ts
docker exec -it kicktick-relayer npx ts-node src/scripts/verify-tokens.ts
```

The CPI spike checks TxOracle proof feasibility. Token verification checks the
devnet TxL and USDC collateral mint accounts. Neither script is part of normal startup.

## Wallet order runner

The repository runner mounts `kicktick/scripts/wallets` read-only and sets
`TEST_WALLETS_DIR` inside the container:

```bash
TEST_MARKET=<market-pda> \
TEST_WALLETS=wallet-01.json,wallet-02.json \
./scripts/run.sh test-runner
```

The variables must be supplied through the relayer environment file or a
container-compatible environment configuration. `TEST_MARKET` is required;
`TEST_WALLETS`, `TEST_WS_URL`, `TEST_QUANTITY`, and `TEST_PRICE_BPS` are
optional.

## Debugging

- `docker logs -f kicktick-relayer` shows startup, recovery, and SSE logs.
- Timestamped raw SSE logs are written under `relayer/logs/`.
- `relayer/data/` contains durable CLOB and lifecycle state; do not delete it
  while investigating recovery.
- If the IDL is stale, build contracts first and rebuild the relayer image.
- Missing TxLINE credentials trigger guest-auth fallback with limited access.
