---
id: program-architecture
type: architecture
title: "On-Chain Account Model"
service: program
depends_on:
  - program-readme
related_to:
  - program-instructions
  - program-constants
tags: [architecture, PDA, state, seeds]
---

# On-Chain Account Model

## Config PDA

**Seeds:** `["config"]`

```
Config PDA
├── admin: Pubkey
├── txoracle_program_id: Pubkey
├── daily_scores_merkle_roots: Pubkey
├── finality_delay: i64
├── min_liquidity: u64
└── bump: u8
```

One per program. Initialized via `init_config`. Stores admin key, oracle program reference, and global settings.

---

## Match_ PDA

**Seeds:** `["match", fixture_id (i64 LE)]`

```
Match_ PDA
├── fixture_id: i64
├── status: MatchStatus (Pending/Live/Finished/Cancelled)
├── home_team: String
├── away_team: String
├── competition_id: i32
├── vault_bump: u8
├── market_seq_counter: u64
├── total_deposited: u64
├── total_sponsored: u64
└── created_at: i64
```

One per fixture. Tracks match lifecycle and aggregate totals.

---

## Market PDA

**Seeds:** `["market", fixture_id (i64 LE), market_type (u8), market_seq (u64 LE)]`

```
Market PDA
├── fixture_id: i64
├── market_type: MarketType
├── market_seq: u64
├── params: MarketParams (participant, period, baseline_a, baseline_b)
├── status: MarketStatus (Open/Locked/ResolvedPending/Resolved/Voided)
├── outcome: MarketOutcome
├── total_yes: u64
├── total_no: u64
├── total_abstain: u64
├── expires_at: i64
├── settle_at: i64
├── winner: Option<u8> (1=YES, 2=NO, 3=abstain, 0=void)
└── claimed: bool
```

One per tradable market. Core state machine for CLOB lifecycle and final resolution.

---

## Position PDA

**Seeds:** `["position", market_pubkey, owner]`

```
Position PDA
├── owner: Pubkey
├── fixture_id: i64
├── market: Pubkey
├── side: u8 (0=YES, 1=NO, 2=abstain)
├── amount: u64
└── claimed: bool
```

One per bettor per market. Tracks individual position and claim status.

---

## SponsorVault PDA

**Seeds:** `["sponsor_vault"]`

```
SponsorVault PDA
├── total_balance: u64
├── allocated: u64
└── bump: u8
```

Global sponsor liquidity pool. One per program.

---

## MarketVault

**Seeds:** `["market_vault", market_pubkey]`
**Type:** System-owned account (no data)

Holds lamports for market collateral and complete-set funds. No structured data.

---

## Account Summary Table

| PDA | Seeds | Type | Purpose |
|---------|-------|------|---------|
| Config | `["config"]` | Anchor | Admin, oracle program id, relayer |
| Match_ | `["match", fixture_id]` | Anchor | Match lifecycle, fixture metadata |
| Market | `["market", fixture_id, market_type, market_seq]` | Anchor | Tradable market state |
| Position | `["position", market, owner]` | Anchor | User position per market |
| SponsorVault | `["sponsor_vault"]` | Anchor | Global sponsor liquidity |
| MarketVault | `["market_vault", market]` | System (no data) | SOL pool, holds market collateral |
