---
id: integration-environment
type: reference
title: "Environment & Network Configuration"
service: integration
depends_on: []
related_to:
  - program-constants
  - integration-dependencies
tags: [environment, network, program-IDs, endpoints]
---

# Environment & Network Configuration

## Program IDs

| Component | Devnet | Mainnet |
|-----------|--------|---------|
| **KickTick** | `LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND` | Devnet/current IDL |
| **TxOracle** | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` |

The KickTick ID is declared in `kicktick/programs/kicktick/src/lib.rs` and
`kicktick/Anchor.toml`. The TxOracle ID is defined in program constants and the
relayer network configuration.

## Token Mints

| Token | Devnet Address | Program | Decimals |
|-------|---------------|---------|----------|
| **TxL** | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` | Token-2022 | 9 |
| **USDC collateral** | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Legacy SPL Token | 6 |

## Network Endpoints

| Service | URL |
|---------|-----|
| Solana Devnet RPC | `https://api.devnet.solana.com` |
| TxLINE Devnet API | `https://txline-dev.txodds.com` |
| TxLINE Mainnet API | `https://txline.txodds.com` |

## Environment Variables

| Variable | Default | Used In |
|----------|---------|--------|
| `TXLINE_JWT` | — | relayer |
| `TXLINE_API_TOKEN` | — | relayer |
| `TXLINE_API_HOST` | `https://txline-dev.txodds.com` | relayer |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | relayer |
| `SOLANA_RPC_MIN_INTERVAL_MS` | `750` | relayer HTTP RPC throttle |
| `SOLANA_KEYPAIR_PATH` | `~/.config/solana/id.json` | relayer |
| `KICKTICK_PROGRAM_ID` | `LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND` | relayer |
| `TXORACLE_PROGRAM_ID` | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | relayer |
| `COLLATERAL_MINT` | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | relayer and Config initialization |
| `WS_PORT` | `8080` | relayer |
| `CLOB_DB_PATH` | `/app/data/kicktick-clob.sqlite` | relayer SQLite database |
| `TEST_MODE` | `false` | relayer dev-only test control plane |
| `TEST_AUTH_REQUIRED` | `false` | require relayer-wallet signature for test controls |
| `CLOB_ONLY_MODE` | unused | compatibility variable; current runtime ignores it |
| `VITE_SOLANA_RPC_URL` | `https://api.devnet.solana.com` | frontend |
| `VITE_KICKTICK_PROGRAM_ID` | `LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND` | frontend |
| `VITE_RELAYER_WS_URL` | `ws://localhost:8080` | frontend CLOB WebSocket |

## Config Values (On-Chain)

| Parameter | Value | Source |
|-----------|-------|--------|
| Min market duration | **15 seconds** | `constants.rs:17` |
| Max market duration | **300 seconds** (5 min) | `constants.rs:18` |
| Confirmation delay | **0 seconds** in current `Config` | `Config.finality_delay` (compatibility field) |
| Lock behavior | **Event-driven**; also allowed after deadline | `market.rs::lock_market_handler` |
| Default deadline seconds | **120 seconds** | `constants.rs:21` |
| Min configured liquidity | **0.01 USDC** (10,000 base units) | `constants.rs` |
| CPI compute units | **1,400,000** | `constants.rs:28` |

## Relayer development mode

The current relayer always runs the full recovery, TxLINE authentication,
fixture ingestion, SSE, lifecycle, cleanup, and scheduler path. `TEST_MODE=true`
or `NODE_ENV=development` additionally registers the synthetic test control
plane. `CLOB_ONLY_MODE` is not consulted by the current runtime.

`TEST_AUTH_REQUIRED=false` lets local development clients use the test control
plane without signing the relayer-admin challenge. Set it to `true` before the
development service is reachable outside a trusted local environment, and do
not enable the test control plane in production.

## Related Docs

- `services/relayer/API.md` — WebSocket protocol and test control plane
- `services/relayer/SETTLEMENT.md` — CLOB fill and market resolution recovery
- `program/ARCHITECTURE.md` — PDA seeds and account model
- `operations/TROUBLESHOOTING.md` — error codes
- `program/BUILD.md` — deploy instructions
