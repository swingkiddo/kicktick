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
| **KickTick** | `7Pc2ipKnDya7UKhQVQA2zdateaLpgHGQbyNt34R5dNF4` | Devnet/current IDL |
| **TxOracle** | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` |

Defined in: `kicktick/programs/kicktick/src/constants.rs:4`

## Token Mints

| Token | Devnet Address | Program | Decimals |
|-------|---------------|---------|----------|
| **TxL** | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` | Token-2022 | 9 |
| **USDT** | `ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh` | Token | 6 |

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
| `SOLANA_KEYPAIR_PATH` | `~/.config/solana/id.json` | relayer |
| `KICKTICK_PROGRAM_ID` | `7Pc2ipKnDya7UKhQVQA2zdateaLpgHGQbyNt34R5dNF4` | relayer |
| `TXORACLE_PROGRAM_ID` | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | relayer |
| `WS_PORT` | `8080` | relayer |
| `CLOB_DB_PATH` | `/app/data/kicktick-clob.sqlite` | relayer SQLite database |
| `TEST_MODE` | `false` | relayer dev-only test control plane |
| `VITE_SOLANA_RPC_URL` | `https://api.devnet.solana.com` | frontend |
| `VITE_KICKTICK_PROGRAM_ID` | `HrMUXZQ7WQ5uNnUWvf5bm2ZgA3En6VBmip78vLSdREqg` | frontend |
| `VITE_RELAYER_WS_URL` | `ws://localhost:8080` | frontend CLOB WebSocket |

## Config Values (On-Chain)

| Parameter | Value | Source |
|-----------|-------|--------|
| Min market duration | **15 seconds** | `constants.rs:17` |
| Max market duration | **300 seconds** (5 min) | `constants.rs:18` |
| Confirmation delay | **0 seconds** in current `Config` | `Config.finality_delay` (compatibility field) |
| Lock behavior | **Event-driven**; also allowed after deadline | `market.rs::lock_market_handler` |
| Default deadline seconds | **120 seconds** | `constants.rs:21` |
| Min configured liquidity | **0.01 SOL** (10M lamports) | `constants.rs:25` |
| CPI compute units | **1,400,000** | `constants.rs:28` |

## Related Docs

- `services/relayer/API.md` — WebSocket protocol and test control plane
- `services/relayer/SETTLEMENT.md` — CLOB fill and market resolution recovery
- `program/ARCHITECTURE.md` — PDA seeds and account model
- `operations/TROUBLESHOOTING.md` — error codes
- `program/BUILD.md` — deploy instructions
