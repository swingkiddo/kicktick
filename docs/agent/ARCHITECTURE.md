# KickTick — System Architecture

> Three subsystems: Anchor program (on-chain) ↔ Relayer (off-chain crank) ↔ Frontend (Next.js)

---

## Data Flow

```
                         TxLINE API (txline-dev.txodds.com)
                      ┌──────────────────────────────────┐
                      │  POST /auth/guest/start → JWT     │
                      │  POST /api/token/activate         │
                      │  GET  /api/odds/snapshot/{id}     │
                      │  GET  /api/scores/stat-validation │
                      │  GET  /api/odds/stream (SSE)      │
                      │  GET  /api/scores/stream (SSE)    │
                      └─────────────┬────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────┐
│  RELAYER (Node/TS crank — no DB, no REST API)              │
│                                                             │
│  txline-auth.ts ──► txodds-client SDK ──► JWT + API token  │
│                                                             │
│  SSE scores stream ──► fixture-watcher (StatusId 1-19)     │
│       │                                                     │
│       ▼                                                     │
│  market-trigger.ts (rules engine)                           │
│    • Event-triggered: goal→NextGoalSide, corner→NextCorner  │
│    • Cron: every 5min→GoalInWindow                          │
│    • Shootout mode: PE status→sequential rounds             │
│    • Timeouts: deadline→settle(NO)                          │
│       │                                                     │
│       ├──► proof-gatherer (GET /stat-validation)            │
│       │       │                                             │
│       │       ▼                                             │
│       │   crank.ts (build tx → sign → send to devnet)     │
│       │       │                                             │
│       └──► ws-server.ts (WebSocket → frontend)             │
└──────────┬────────────────────────────────────────────────┘
           │ CPI validate_stat               │ WebSocket
           ▼                                 ▼
┌──────────────────────┐       ┌──────────────────────┐
│ Solana Devnet        │       │ Frontend (Next.js)    │
│                      │       │                       │
│ kicktick program     │       │ Header (wallet)       │
│   init_config        │       │ MarketCard (bet UI)   │
│   init_match         │       │ CreateMarketModal     │
│   open_round         │       │ LiveOddsFeed (demo)   │
│   place_bet          │       │                       │
│   settle_round       │       │ Wallet: Phantom/Solflare│
│   settle_offchain_round│     │                       │
│   confirm_round      │       │ Currently: demo data  │
│   claim_winnings     │       │ No on-chain integration│
│   cancel_round       │       │ yet                   │
│   challenge_equivocation│   │                       │
│ txoracle program     │       │ No on-chain integration│
│   validate_stat (CPI)│       │ yet                   │
└──────────────────────┘       └──────────────────────┘
```

---

## Component Responsibilities

### Anchor Program (trustless, on-chain)
- Match/Round lifecycle (Open → Locked → Settled/Cancelled/Voided)
- Native SOL custody in MatchVault (system-owned PDA per match)
- Position tracking per user per round
- Settlement via CPI txoracle::validate_stat or off-chain relayer
- Instructions: init_config, init_match, open_round, place_bet, settle_round, settle_offchain_round, confirm_round, claim_winnings, cancel_round, challenge_equivocation, fund_sponsor, sponsor_round
- **Current:** Phase 1 — modular, native SOL, Match/Round/Position/SponsorVault

### Relayer (off-chain crank, trusted for MVP)
- No database, no user sessions, no REST API
- SSE consumer: parses live match actions (goal, corner, card, VAR)
- Market trigger rules: opens/closes rounds based on match events
- Proof gatherer: fetches Merkle proofs from TxLINE REST
- Crank: builds and sends Solana transactions
- WebSocket: pushes round statuses to frontend

### Frontend (Next.js, currently demo-only)
- Wallet connection (Phantom, Solflare)
- Market browsing with bet interface
- Live odds visualization (demo data)
- Market creation modal

---

## On-Chain Account Model (Phase 1)

```
Config PDA (seeds=["config"])
├── admin: Pubkey
├── txoracle_program_id: Pubkey
├── daily_scores_merkle_roots: Pubkey
├── finality_delay: i64
├── min_liquidity: u64
└── bump: u8

Match_ PDA (seeds=["match", fixture_id])
├── fixture_id: i64
├── status: MatchStatus (Pending/Live/Finished/Cancelled)
├── home_team: String
├── away_team: String
├── competition_id: i32
├── vault_bump: u8
├── round_counter: u64
├── total_deposited: u64
├── total_sponsored: u64
└── created_at: i64

Round PDA (seeds=["round", match_pubkey, round_id])
├── match_pda: Pubkey
├── round_id: u64
├── market_type: MarketType
├── params: RoundParams (lock_seconds, deadline_seconds)
├── settlement_model: OnChain/OffChain
├── status: RoundStatus (Open/Locked/ResolvedPending/Settled/Voided/Cancelled)
├── outcome: RoundOutcome
├── total_yes/no/abstain: u64
├── expires_at: i64
├── settle_at: i64
├── winner: Option<u8> (1=YES,2=NO,3=abstain,0=void)
└── claimed: bool

Position PDA (seeds=["position", fixture_id, round_id, owner])
├── owner: Pubkey
├── fixture_id: i64
├── round_id: u64
├── side: u8 (0=YES,1=NO,2=abstain)
├── amount: u64
└── claimed: bool

SponsorVault PDA (seeds=["sponsor_vault"])
├── total_balance: u64
├── allocated: u64
└── bump: u8

MatchVault — system-owned account (seeds=["match_vault", match_pubkey])
└── no data, holds lamports
```

---

## Settlement (Phase 1)

- **On-chain:** `settle_round` → CPI `txoracle::validate_stat`. Binary/ternary predicates per MarketType. Proof accounts required.
- **Off-chain:** `settle_offchain_round` → relayer sets outcome (PenaltyShot, VARCheck).
- **Confirm:** `confirm_round` after `FINALITY_DELAY_SECONDS` (60s).
- **Payout:** `claim_winnings` → pro-rata `(position.amount * total_pool) / winning_pool`.
- **Refund:** voided/cancelled rounds return full `position.amount`.

StatKey map:
| Key | Stat |
|-----|------|
| 1 | P1 Goals |
| 2 | P2 Goals |
| 3 | P1 Yellow Cards |
| 4 | P2 Yellow Cards |
| 5 | P1 Red Cards |
| 6 | P2 Red Cards |
| 7 | P1 Corners |
| 8 | P2 Corners |
| 5001 | P1 Penalty Shootout Goals |
| 5002 | P2 Penalty Shootout Goals |
Period modifiers: +1000 (H1), +2000 (H2), +5000 (PE)

---

## SSE Event Types (TxLINE Soccer Feed)

Key actions that drive market triggers:
- `goal` → close NextGoalSide, open new one
- `corner` → close NextCorner, open new one
- `yellow_card` → close NextYellowCard, open new one
- `red_card` → settle RedCardInMatch(YES)
- `penalty` → open PenaltyShot
- `penalty_outcome` {Scored/Missed/Retake} → settle or extend
- `var`/`var_end` → open/settle VARCheck
- `status` {StatusId} → phase transitions (HT, ET, PE, F)
- `possible` → pre-market triggers (future use)

Match phases: NS(1) → H1(2) → HT(3) → H2(4) → F(5) → WET(6) → ET(7-10) → WPE(11) → **PE(12)** → FPE(13)

---

## Account Summary Table

| PDA | Seeds | Type | Purpose |
|---------|-------|------|---------|
| Config | `["config"]` | Anchor | Admin, oracle program id, settings |
| Match_ | `["match", fixture_id]` | Anchor | Match lifecycle, vault_bump |
| Round | `["round", match_pubkey, round_id]` | Anchor | Market round state |
| Position | `["position", fixture_id, round_id, owner]` | Anchor | User position per round |
| SponsorVault | `["sponsor_vault"]` | Anchor | Global sponsor liquidity |
| MatchVault | `["match_vault", match_pubkey]` | System (no data) | SOL pool, holds lamports |
