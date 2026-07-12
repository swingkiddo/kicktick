# KickTick: Sub-Minute Micro Prediction Markets on Solana

Create and settle prediction markets in **under 60 seconds** using live TxODDS odds data + on-chain Merkle proof settlement via CPI to the `txoracle` program.

**World Cup Hackathon** — Superteam × Solana, powered by TxODDS

## Market Types

| Type | Description | Settlement |
|------|-------------|------------|
| `next_goal` | Which team scores next? | CPI (ternary: home/away/draw) |
| `next_goal_side` | Will next goal be by home team? | CPI (ternary) |
| `goal_in_window` | Goal in next N minutes? | CPI (binary) |
| `next_corner` | Corner in next 5 min? | CPI (binary) |
| `next_card` | Card in next 5 min? | CPI (binary) |
| `over_under_corners` | Corners threshold in window? | CPI (binary) |
| `penalty_shootout` | Penalty round outcome | CPI + off-chain fallback |
| `var_check` | VAR overturn? | Off-chain (relayer) |

## Key Features

- **SPL USDC collateral** — configured legacy SPL Token vaults for users and markets
- **Binary CLOB/CTF trading** — exact BUY reserves, direct share trades, and complete-set creation
- **CPI settlement** — `resolve_market_with_proof` calls `txoracle::validate_stat` on-chain
- **Off-chain resolution** — `resolve_market_offchain` for PenaltyShot/VARCheck
- **Event-driven market lifecycle** — markets stay open until the outcome is known or the deadline expires; current confirmation is immediate
- **Event-driven** — SSE from TxLINE triggers market creation and settlement
- **PDA vaults** — MatchVault (system-owned), Position tracking, SponsorVault

## Architecture

```
                    TxLINE API (txline-dev.txodds.com)
                 ┌──────────────────────────────────┐
                 │  Guest JWT + API token            │
                 │  SSE odds/scores streams          │
                 │  REST stat-validation (Merkle)    │
                 └─────────────┬────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────┐
│  RELAYER (Node/TS — off-chain crank + SQLite CLOB)    │
│                                                      │
│  TxLINE client → score mapper → fixture watcher      │
│  market triggers → durable lifecycle executor        │
│  CLOB matching → fill settlement → Anchor client     │
│  proof-gatherer → crank → WebSocket transport        │
└──────────┬───────────────────────────────────────────┘
           │ CPI validate_stat          │ WebSocket
           ▼                            ▼
┌─────────────────────┐    ┌─────────────────────────┐
│ Solana Devnet       │    │ Frontend (Next.js)       │
│                     │    │                          │
│ kicktick program    │    │ Wallet (Phantom/Solflare)│
│  init_config        │    │ Live market board       │
│  init_match         │    │ Orderbook + order form  │
│  init_market        │    │ Portfolio + claims      │
│  lock_market        │    │                          │
│  resolve_market_*   │    └─────────────────────────┘
│  confirm_market     │
│  split / merge      │
│  settle_complete_set│
│  settle_share_trade │
│  claim              │
│                     │
│ txoracle program    │
│  validate_stat (CPI)│
└─────────────────────┘
```

## Repository Structure

```
kicktick/
├── README.md
├── AGENTS.md                    # Agent instructions
├── docker-compose.yml           # Dev orchestration
├── docker-compose.prod.yml      # Prod orchestration
├── scripts/
│   ├── build.sh                 # Docker build [all|contracts|frontend|relayer]
│   └── deploy.sh                # Deploy [devnet|mainnet]
├── docs/agent/                  # Full agent documentation
├── kicktick/                    # Anchor workspace
│   ├── Anchor.toml
│   ├── programs/kicktick/src/   # On-chain program (Rust)
│   ├── tests/                   # Integration tests
│   └── scripts/                 # Anchor scripts
├── relayer/                     # Off-chain crank (Node/TS)
│   ├── src/
│   │   ├── txline-auth.ts       # TxLINE JWT auth
│   │   ├── cpi-spike.ts         # CPI validation test
│   │   ├── verify-tokens.ts     # Token mint checker
│   │   ├── config.ts            # Relayer config
│   │   └── index.ts             # Entry point
│   └── package.json
└── frontend/                    # Next.js UI
    ├── app/                     # App Router pages
    ├── components/              # React components
    ├── lib/                     # Utilities
    └── package.json
```

## Quick Start

```bash
# 1. Clone and enter the repository
git clone https://github.com/Kubo-cmd/kicktick.git
cd kicktick

# 2. Configure wallet (devnet)
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 2

# 3. Build all services
./scripts/build.sh all dev

# 4. Deploy program to devnet
./scripts/deploy.sh devnet

# 5. Start services through Docker
./scripts/run.sh all
```

## Build & Deploy

```bash
# Build Docker images
./scripts/build.sh [all|contracts|frontend|relayer] [dev|prod]

# Deploy to devnet (auto-builds contracts if needed)
./scripts/deploy.sh [devnet|mainnet] [priority_fee]
```

Deployment info saved to `deployment-{network}.json`.

## Program IDs (Devnet)

| Component | Address |
|-----------|---------|
| KickTick program | `LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND` |
| TxOracle program | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| TxL mint (Token-2022) | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| USDC collateral mint (Token) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

## On-Chain Config

| Parameter | Value |
|-----------|-------|
| Min market duration | 15 seconds |
| Max market duration | 300 seconds (5 min) |
| Confirmation delay | 0 seconds in current Config |
| Lock behavior | Event-driven, or permissionless after deadline |
| Min configured liquidity | 0.01 USDC (10,000 base units) |
| CPI compute units | 1,400,000 |

## Market Lifecycle

1. Relayer detects match event via SSE (goal, corner, card, etc.)
2. `init_market` — market opens with captured oracle parameters
3. Relayer matches signed CLOB orders off-chain
4. `settle_complete_set` or `settle_share_trade` applies binary fills on-chain
5. When the resolution condition is observed (for example, a goal), the relayer locks the market immediately; otherwise it locks it after the deadline
6. `resolve_market_with_proof` or `resolve_market_offchain` records the outcome
7. `confirm_market` immediately finalizes the market
8. Users call `claim` for winning or voided shares

## Development Status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | TxLINE auth, CPI spike test, token verification | ✅ Done |
| 1 | Anchor program (USDC Market/CLOB lifecycle) | ✅ Done |
| 2 | Relayer SSE parser, market triggers, crank, WebSocket | ⏳ In progress |
| 3 | Replay engine + demo | ⏳ Pending |

## Security

- All settlements reference verifiable TxODDS Merkle data via CPI
- PDA-controlled vaults (no privileged withdrawal keys)
- Strict duration + overflow checks on-chain
- Equivocation challenge mechanism
- Event-driven lock prevents trading after the outcome becomes known

## Documentation

Full agent documentation in `docs/agent/`:

```
docs/agent/overview/    → Project context, architecture, roadmap
docs/agent/services/    → Program, relayer, frontend deep docs
docs/agent/integration/ → Data flow, dependencies, environment
docs/agent/operations/  → Workflows, troubleshooting
```

## License

MIT
