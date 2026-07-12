# KickTick — Agent Instructions

> **Project:** In-play Micro Prediction Markets on Solana. World Cup Hackathon — Superteam × Solana.
> **Subsystems:** Anchor Program (`kicktick/`) · Relayer (`relayer/`) · Frontend (`frontend/`)

KickTick uses a Polymarket-style prediction-market model for short, live sports
events. Users trade positions
on binary or multi-outcome in-play markets, and those markets resolve from
verifiable match data.

---

## 1. Documentation First

**Before any task, consult `docs/agent/AGENTS.md` as the single entry point.**

Reading order for new agents:

```
docs/agent/AGENTS.md
  → docs/agent/overview/PROJECT.md
  → docs/agent/overview/ARCHITECTURE.md
  → docs/agent/services/program/README.md
```

Full documentation tree lives under `docs/agent/`:

| Directory | Contents |
|-----------|----------|
| `docs/agent/overview/` | Project context, architecture, roadmap |
| `docs/agent/services/program/` | Anchor program: architecture, instructions, constants, build, deploy |
| `docs/agent/services/relayer/` | Off-chain crank service |
| `docs/agent/services/frontend/` | Next.js UI |
| `docs/agent/integration/` | Data flow, dependencies, environment config |
| `docs/agent/operations/` | Workflows, structure, troubleshooting |

**Rules:**
- Do NOT guess project structure, program IDs, endpoints, or env vars — read the docs.
- If a doc is outdated or missing, flag it. Do not silently work around it.
- All docs carry YAML frontmatter for graph-based navigation.
- Use **In-play Micro Prediction Market** as the canonical product term.
- Use **market**, **position**, **outcome**, **share**, **price**, **probability**, and **resolution** for product concepts.
- Use the canonical market vocabulary in all new docs, UI text, code comments, and API names; do not reintroduce deprecated product language.
- “Odds” is allowed only when referring to the external TxODDS/TxLINE data feed; it is not the name of KickTick’s market mechanism.
- When editing documentation, replace legacy product language in the touched section and flag remaining occurrences for the documentation cleanup.
- DO NOT USE LORE SKILLS 

---

## 2. Builds, Deploys & Tests — Use Scripts

All build and deploy operations MUST go through the scripts in `/scripts/`. Do NOT run raw Docker or Anchor commands directly unless debugging.

### Build

```bash
./scripts/build.sh [all|contracts|frontend|relayer] [dev|prod]
```

- Default: `all`, `dev`
- Builds Docker images for each subsystem.

### Deploy

```bash
./scripts/deploy.sh [devnet|mainnet] [priority_fee]
```

- Default: `devnet`, priority fee `10000` micro-lamports/CU
- Auto-builds contracts image if missing.
- Saves deployment info to `deployment-{network}.json`.

### Tests

```bash
# From project root (via Docker)
./scripts/build.sh contracts   # ensure image exists
# Then inside the container or via anchor:
anchor test
```

**Rules:**
- Never deploy without building first. `deploy.sh` handles this automatically.
- Never hardcode program IDs or network URLs in code — use `docs/agent/integration/ENVIRONMENT.md`.

---

## 3. Tool Routing

Use the correct MCP server for the domain. Do NOT attempt to answer cross-domain questions without the proper tool.

| Domain | Tool | When to use |
|--------|------|-------------|
| **Solana blockchain** | `solanaMcp` | Program interactions, PDAs, CPI, accounts, cluster queries, Anchor, SPL tokens, TxOracle integration, any on-chain question |
| **Rust language** | `rust-mcp` | Rust compilation errors, cargo commands, code analysis, dependency management, formatting, testing, security audits |
| **PDF files** | `pdf-reader` | Reading/extracting text from PDF documents, OCR for scanned PDFs |

**Rules:**
- Solana questions that touch Rust (e.g., program code) → use BOTH `solanaMcp` AND `rust-mcp`.
- When in doubt about which tool applies, use both.
- Always validate Solana program changes with `solanaMcp_program_autofixer` before deploying.

---

## 4. Network Config (Devnet)

| Component | Address |
|-----------|---------|
| KickTick program | `LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND` |
| TxOracle program | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| TxL mint (Token-2022) | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| USDC collateral mint (Token) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| RPC | `https://api.devnet.solana.com` |
| TxLINE API | `https://txline-dev.txodds.com` |

---

## 6. Docker-Only Launch

**All services MUST run inside Docker.** No bare-metal `npm run dev`, `anchor test`, or `cargo build` outside the container.

```bash
# Build all images (dev profile)
./scripts/build.sh

# Run all services (auto-builds missing images)
./scripts/run.sh all           # foreground (Ctrl+C stops all)
./scripts/run.sh all -d        # detached

# Run individual services
./scripts/run.sh contracts     # starts background container, prints exec command
./scripts/run.sh frontend      # serves on :3000
./scripts/run.sh relayer       # serves on :8080

# Deploy contracts to devnet (builds image if missing)
./scripts/deploy.sh devnet
```

**Rules:**
- If the image is missing, `run.sh` calls `build.sh` automatically — no manual build needed.
- Contracts container runs `sleep infinity` — use `docker exec -it kicktick-contracts bash` to run Anchor commands.
- Always use `./scripts/run.sh`, not raw `docker run` or `docker compose`.

---

## 7. General Rules

- **Read before writing.** Understand existing code and docs before making changes.
- **Atomic changes.** One logical change per commit.
- **No secrets in code.** Use `.env` files. Never commit keypairs or private keys.
- **Verify after changes.** Run builds and tests after modifications. Use `solanaMcp_program_autofixer` for program changes.
- **Ask before assuming.** If requirements are ambiguous, ask. Do not guess intent.
