# KickTick — Backend Development Roadmap

> **Deadline:** July 19, 2026
> **Stack:** Anchor/Rust (Solana), Node/TS (Relayer), Solana Devnet
> **TxLINE SDK:** [`txodds-client`](https://github.com/swingkiddo/txodds-client) — готовый клиент для работы с TxLINE API (аутентификация, SSE stream, stat-validation), ускоряет разработку релейера
> **Phase 0:** ✅ Completed July 3, 2026 — 5 atomic commits on `feat/backend`

---

## Overview

Backend consists of two independent subsystems:

| Subsystem | Language | Purpose |
|-----------|----------|---------|
| **Anchor Program** (`kicktick`) | Rust | On-chain smart contract — PDAs, CPI settlement, bet accounting |
| **Relayer** | Node/TS | Off-chain worker — SSE ingestion, market triggers, proof gathering, tx crank |

Both must integrate: relayer calls the Anchor program via Solana transactions.

---

## Phase 0 — Spike & Environment Setup (Days 1–2) ✅

Validate core assumptions before building.

| Task | Output | Verification | Status |
|------|--------|-------------|--------|
| 0.1 Obtain JWT + API token from TxLINE | `relayer/src/txline-auth.ts` — `authenticateGuest()`, `activateApiToken()` | API returns 200 | ✅ |
| 0.2 Test `validate_stat` CPI on devnet | `relayer/src/cpi-spike.ts` — validates CPI feasibility, PDA derivation, on-chain program check | CPI accounts derive correctly; `daily_scores_roots` PDA needs active fixture | ✅ |
| 0.3 Set up Anchor workspace | `kicktick/` — program `CCmcpUZttSJqUabxBcyvHp4uC89EkrXce5YSEvRgE7tc` deployed to devnet | `anchor build` passes, deployed | ✅ |
| 0.4 Set up relayer workspace | `relayer/` with `package.json`, `tsconfig`, `src/index.ts` | `npm run build` compiles | ✅ |
| 0.5 Verify TxL and USDT token programs | `relayer/src/verify-tokens.ts` — confirms mints on devnet | TxL (Token-2022) `4Zao...`, USDT (Token) `ELWT...` both exist | ✅ |

**Go/No-Go:** ✅ CPI spike passed — `txoracle` program exists on devnet (`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`), proof format matches expected CPI layout. Using CPI `validate_stat` for on-chain settlement.

### Phase 0 Deliverables

| Commit | Description |
|--------|-------------|
| `10358ca` | `build(anchor): scaffold Anchor workspace with prediction market program on devnet` — Rust 1.85.0, Anchor 1.0.0, 6 instructions, 3 PDAs, 5 MarketTypes, 15 errors |
| `2faf4d4` | `build(client): bump Anchor SDK from ^0.30.1 to ^0.32.0` |
| `92d8870` | `chore(relayer): scaffold Node/TS workspace with TxLINE auth module` — config, txline-auth |
| `12196b0` | `test(relayer): add CPI spike test and token mint verification` |
| `1830bcc` | `chore: configure gitignore and project environment template` |

### Key Findings

| Finding | Detail |
|---------|--------|
| **Program IDs confirmed** | TxLINE docs: Program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`, TxL `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`, USDT `ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh` |
| **TxL uses Token-2022** | `TOKEN_2022_PROGRAM_ID` for subscription, USDT uses original `TOKEN_PROGRAM_ID` |
| **CPI accounts derived** | `daily_scores_roots` PDA needs epoch day + active fixture with scores recorded |
| **Auth flow works** | Guest JWT obtained, API token activation requires on-chain subscription tx |
| **Program architecture** | Current program uses `PredictionMarket`/`Position`/`MarketVault` with odds-based settlement — Phase 1 refactors to Match/Round/SessionBudget model with CPI `validate_stat` |

---

## Phase 1 — Anchor Program: Core (Days 3–7)

All PDAs, instructions, and settlement logic on-chain.

### 1.1 State Layer

| Task | Files | Depends On |
|------|-------|------------|
| 1.1.1 Config PDA + constants + errors | `state/config.rs`, `constants.rs`, `errors.rs` | — |
| 1.1.2 Match PDA + MatchVault PDA | `state/match_.rs`, `state/vault.rs` | 1.1.1 |
| 1.1.3 Round PDA (enum + params + status) | `state/round.rs` | 1.1.1 |
| 1.1.4 Position PDA | `state/position.rs` | 1.1.1 |
| 1.1.5 SessionBudget PDA + SponsorVault PDA | `state/budget.rs`, `state/vault.rs` | 1.1.1 |

### 1.2 Instructions

| Task | Files | Depends On |
|------|-------|------------|
| 1.2.1 `init_match` + `fund_sponsor` | `instructions/init_match.rs`, `instructions/fund_sponsor.rs` | 1.1.2 |
| 1.2.2 `open_round` with MarketType validation | `instructions/open_round.rs` | 1.1.3 |
| 1.2.3 `fund_session_budget` | `instructions/fund_session_budget.rs` | 1.1.5 |
| 1.2.4 `place_bet` (debit SessionBudget, create Position) | `instructions/place_bet.rs` | 1.1.4, 1.1.5 |
| 1.2.5 `sponsor_round` (seed liquidity) | `instructions/fund_sponsor.rs` | 1.1.5 |

### 1.3 Settlement (★ Critical Path)

| Task | Files | Depends On |
|------|-------|------------|
| 1.3.1 `settle_round` — CPI `validate_stat` with statKey mapping | `instructions/settle_round.rs` | 1.1.3 |
| 1.3.2 Ternary logic (NextGoalSide: Home/Away/NoGoal) | `instructions/settle_round.rs` | 1.3.1 |
| 1.3.3 Binary logic (GoalInWindow, RedCardInMatch, etc.) | `instructions/settle_round.rs` | 1.3.1 |
| 1.3.4 PenaltyShootoutShot (statKey 5001/5002 with period modifier) | `instructions/settle_round.rs` | 1.3.1 |
| 1.3.5 `settle_offchain_round` (PenaltyShot, VARCheck) | `instructions/settle_offchain_round.rs` | 1.1.3 |
| 1.3.6 `confirm_round` (finality delay) | `instructions/confirm_round.rs` | 1.3.x |
| 1.3.7 `claim` (pro-rata + refund) | `instructions/claim.rs` | 1.1.4 |
| 1.3.8 `cancel_round` (min liquidity check) | `instructions/cancel_round.rs` | 1.1.3 |
| 1.3.9 `challenge_equivocation` | `instructions/cancel_round.rs` | 1.1.3 |

### 1.4 Tests

| Task | File | Depends On |
|------|------|------------|
| 1.4.1 CPI spike test (raw `validate_stat` call) | `tests/cpi_spike.ts` | 0.2 |
| 1.4.2 Core flow (init → open → bet → settle → claim) | `tests/core.ts` | 1.3.7 |
| 1.4.3 All market type settlement variants | `tests/settlement.ts` | 1.3.x |
| 1.4.4 Edge cases (void, cancel, refund, retake) | `tests/settlement.ts` | 1.3.x |

**MVP Gate:** All 8 market types settle correctly on devnet via manual transaction.

---

## Phase 2 — Relayer: TxLINE Integration (Days 8–11)

Off-chain worker that watches matches and drives the on-chain program.

### 2.1 Connectivity

| Task | Files | Depends On |
|------|-------|------------|
| 2.1.1 `txline-auth.ts` — guest JWT + token activation | `relayer/src/txline-auth.ts` | 0.1 |
| 2.1.2 `txline-client.ts` — SSE scores stream parser | `relayer/src/txline-client.ts` | 2.1.1 |
| 2.1.3 Parse all 18 SSE action types (goal, corner, var, etc.) | `relayer/src/txline-client.ts` | 2.1.2 |
| 2.1.4 Match status tracking (StatusId → phase) | `relayer/src/fixture-watcher.ts` | 2.1.2 |

### 2.2 Market Logic

| Task | Files | Depends On |
|------|-------|------------|
| 2.2.1 Event-triggered rules (goal → NextGoalSide, corner → NextCorner, etc.) | `relayer/src/market-trigger.ts` | 2.1.3 |
| 2.2.2 Cron-triggered rules (GoalInWindow every 5min, CornerInWindow every 3min) | `relayer/src/market-trigger.ts` | 2.1.4 |
| 2.2.3 Penalty shootout mode (PE status → sequential rounds) | `relayer/src/market-trigger.ts` | 2.1.4 |
| 2.2.4 Timeout handling (deadline → close + settle) | `relayer/src/market-trigger.ts` | 2.1.4 |
| 2.2.5 Retake handling (penalty retake → extend deadline) | `relayer/src/market-trigger.ts` | 2.2.1 |

### 2.3 Proof & Settlement Crank

| Task | Files | Depends On |
|------|-------|------------|
| 2.3.1 `proof-gatherer.ts` — fetch Merkle proof via `/stat-validation` | `relayer/src/proof-gatherer.ts` | 0.1 |
| 2.3.2 `crank.ts` — build settle_round tx + send + retry | `relayer/src/crank.ts` | 2.3.1, Phase 1 |
| 2.3.3 `crank.ts` — off-chain settlement (PenaltyShot, VARCheck) | `relayer/src/crank.ts` | 2.3.2 |
| 2.3.4 `ws-server.ts` — WebSocket for frontend (round status, match events) | `relayer/src/ws-server.ts` | 2.2.x |
| 2.3.5 `index.ts` — main loop wiring | `relayer/src/index.ts` | 2.x all |

**MVP Gate:** Relayer auto-opens, auto-settles rounds for a live match feed.

---

## Phase 3 — Replay & Demo (Days 15–18)

Demonstrate the full system without a live match.

| Task | Files | Depends On |
|------|-------|------------|
| 3.1 Load historical match data (TxLAB or JSON) | `relayer/src/replay.ts` | 2.2.x |
| 3.2 Replay at 30x speed through same pipeline | `relayer/src/replay.ts` | 3.1 |
| 3.3 Slow lane 1x mode with step controls | `relayer/src/replay.ts` | 3.2 |
| 3.4 All 8 market types firing in one run | `relayer/src/replay.ts` | 3.2 |
| 3.5 Demo script & fallback video | — | 3.4 |

**Final Gate:** 15-20 rounds settle in 3 minutes via 30x replay.

---

## Dependencies Map

```
Phase 0 (Spike)
  ├── Phase 1 (Anchor Program)
  │     ├── 1.1 State (no deps)
  │     ├── 1.2 Instructions (depends on 1.1)
  │     ├── 1.3 Settlement (depends on 1.1, ★ critical)
  │     └── 1.4 Tests (depends on 1.2-1.3)
  └── Phase 2 (Relayer)
        ├── 2.1 Connectivity (depends on 0.1)
        ├── 2.2 Market Logic (depends on 2.1)
        └── 2.3 Crank (depends on 2.2 + Phase 1 settlement)
              └── Phase 3 (Replay, depends on 2.3)
```

---

## Task List for Claude Code (AI Agent)

Save as `BACKEND_TASKS.md` or reference in `CLAUDE.md`. Each task is a standalone unit an agent can execute.

### Anchor Program (sequential order)

```
       ╔══════════════════════════════════════════════════════╗
       ║  Phase 0 done: current program is simpler (6 ixns)  ║
       ║  Phase 1 rewrites to Match/Round/SessionBudget arch ║
       ╚══════════════════════════════════════════════════════╝

ph0   001 — Scaffold: create anchor workspace, lib.rs, Cargo.toml, Anchor.toml [✅]
ph0   002 — Constants + errors module [✅ — in lib.rs]
ph0   003 — Config PDA (admin, txoracle_program_id, finality_delay, min_liquidity) [⬜]
ph0   004 — Match PDA + MatchStatus enum [⬜]
ph0   005 — Round PDA + MarketType + RoundParams + SettlementModel enums [⬜]
ph0   006 — Position PDA [⬜]
ph0   007 — SessionBudget PDA + SponsorVault PDA [⬜]
ph0   008 — init_match instruction [⬜]
ph0   009 — fund_sponsor + sponsor_round instructions [⬜]
        010 — open_round instruction with MarketType validation [⬜]
        011 — fund_session_budget instruction [⬜]
        012 — place_bet instruction (SessionBudget debit + Position create) [⬜]
        013 — settle_round: CPI validate_stat (all market type mappings) [⬜]
        014 — settle_round: ternary/binary/window/shootout logic [⬜]
        015 — settle_offchain_round instruction [⬜]
        016 — confirm_round (finality delay check) [⬜]
        017 — claim (pro-rata + refund) [⬜]
        018 — cancel_round + challenge_equivocation [⬜]
ph0   019 — CPI spike test (manual validate_stat call on devnet) [✅ — relayer/src/cpi-spike.ts]
ph0   020 — Core integration test (full cycle) [⬜ — basic tests exist in kicktick/tests/kicktick.ts]
        021 — Settlement test (all 8 market types) [⬜]
```

### Relayer (sequential order)

```
ph0   022 — Scaffold: package.json, tsconfig, src/index.ts [✅]
ph0   023 — config.ts (env: JWT, API key, RPC, keypair) [✅ — relayer/src/config.ts]
ph0   024 — txline-auth.ts (guest JWT + API token) [✅ — relayer/src/txline-auth.ts]
        025 — txline-client.ts (SSE scores/odds stream) [⬜]
        026 — SSE parser for all 18 action types [⬜]
        027 — fixture-watcher.ts (match status, start/end detection) [⬜]
        028 — market-trigger.ts: event rules (goal, corner, YC, RC, penalty, VAR) [⬜]
        029 — market-trigger.ts: cron windows (GoalInWindow, CornerInWindow, YCInWindow) [⬜]
        030 — market-trigger.ts: shootout mode, timeouts, retakes [⬜]
        031 — proof-gatherer.ts (stat-validation API) [⬜]
        032 — crank.ts (build + send settle_round / settle_offchain_round) [⬜]
        033 — ws-server.ts (WebSocket for frontend) [⬜]
        034 — index.ts (main loop wiring) [⬜]
        035 — replay.ts (30x historical match replay) [⬜]
        036 — replay.ts slow lane 1x mode [⬜]
```

---

## Key Timings

| Phase | Days | Hours (est.) | Dependencies | Status |
|-------|------|-------------|--------------|--------|
| 0 — Spike | 2 | 8-12 | TxLINE API access | ✅ Done (Jul 3) |
| 1 — Anchor Program | 5 | 30-40 | Phase 0 | ⏳ Jul 3–8 |
| 2 — Relayer | 4 | 24-32 | Phase 1 (for crank) | ⏳ Jul 8–12 |
| 3 — Replay/Demo | 4 | 16-20 | Phase 2 | ⏳ Jul 12–16 |

**Buffer:** 3 days (July 16–19) for polish, bug fixes, fallback video.

---

## Risk Flags

| Risk | Trigger | Fallback | Status |
|------|---------|----------|--------|
| CPI spike fails | `validate_stat` returns error | Use 2-of-3 relayer signatures for settlement | ✅ Resolved — CPI valid |
| TxLINE SSE unreliable in devnet | Frequent reconnects | REST poll fallback every 15s |
| CU budget exceeded | Transaction fails | `setComputeUnitLimit(1_400_000)`, split settlement into batches |
| `statKey 5001/5002` unsupported | CPI fails for shootout | Fall back to off-chain shootout settlement |
| Deadline approaching | Week 3 starts with gaps | Reduce market types to 4 core ones (NextGoalSide, GoalInWindow, PenaltyShot, VARCheck) |
