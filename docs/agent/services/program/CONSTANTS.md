---
id: program-constants
type: reference
title: "Constants & Configuration"
service: program
depends_on: []
related_to:
  - program-instructions
  - program-architecture
  - integration-environment
tags: [constants, seeds, enums, errors, StatKey]
---

# KickTick — Constants & Seeds (Phase 1)

> Single source of truth for addresses, seeds, config values. Read before any on-chain interaction.

---

## Program IDs

| Component | Devnet | Mainnet |
|-----------|--------|---------|
| **KickTick** | `DU7KRbgpjdhKtmHwNawUCvy61WMazi76unzNB2Y1chTJ` | TBD |
| **TxOracle** | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` |

Defined in: `kicktick/programs/kicktick/src/constants.rs:4`

---

## PDA Seeds

| Account | Seeds | Notes |
|---------|-------|-------|
| `Config` | `["config"]` | One per program |
| `Match_` | `["match", fixture_id (i64 LE)]` | One per fixture |
| `MatchVault` | `["match_vault", match_pubkey]` | System-owned account, zero data |
| `Round` | `["round", match_pubkey, round_id (u64 LE)]` | One round per match id |
| `Position` | `["position", fixture_id (i64 LE), round_id (u64 LE), owner]` | One per bettor per round |
| `SponsorVault` | `["sponsor_vault"]` | Global sponsor liquidity pool |

Derivation paths: `init_match.rs:58`, `open_round.rs:23`, `place_bet.rs:34`, `fund_sponsor.rs:24`

---

## Enums

### `MarketType`
```rust
// On-chain (CPI validate_stat)
NextGoalSide, GoalInWindow, NextCorner, CornerInWindow,
NextYellowCard, YellowCardInWindow, RedCardInMatch, PenaltyShootoutShot

// Off-chain (relayer sets outcome)
PenaltyShot, VARCheck
```
Defined in: `state/round.rs:6-19`

### `RoundStatus`
```rust
Open, Locked, ResolvedPending, Settled, Voided, Cancelled
```
Defined in: `state/round.rs:63-70`

### `RoundOutcome`
```rust
None, Yes, No, NoGoal, Home, Away, Cancelled
```
Defined in: `state/round.rs:82-89`

---

## Config Values

| Parameter | Value | Source |
|-----------|-------|--------|
| Min market duration | **15 seconds** | `constants.rs:17` |
| Max market duration | **300 seconds** (5 min) | `constants.rs:18` |
| Finality delay | **60 seconds** | `constants.rs:22` |
| Default lock seconds | **15 seconds** | `constants.rs:20` |
| Default deadline seconds | **120 seconds** | `constants.rs:21` |
| Min round liquidity | **0.01 SOL** (10M lamports) | `constants.rs:25` |
| CPI compute units | **1,400,000** | `constants.rs:28` |

---

## Period Encoding

The `period` field in `ScoreStat` selects which game period's stat value to validate.

| Constant | Value | Meaning |
|----------|-------|---------|
| `PERIOD_FULL` | `0` | Full match (all periods aggregated) |
| `PERIOD_H1` | `1_000` | First half only |

> **Note:** Current `constants.rs` has `PERIOD_H1 = 0` (misnamed — acts as FULL). Will be fixed in code migration phase.
| `PERIOD_H2` | `2_000` | Second half only |
| `PERIOD_ET1` | `3_000` | Extra time first half |
| `PERIOD_ET2` | `4_000` | Extra time second half |
| `PERIOD_PE` | `5_000` | Penalty shootout |

Defined in: `constants.rs:40-45`

---

## StatKey Map (TxLINE Soccer Feed v1.0)

### [Program Constants] — Keys used in CPI `validate_stat`

| Key | Stat | Period modifier |
|-----|------|----------------|
| 1 | P1 Total Goals (Score) | +1000 = H1 (+2000 = H2) |
| 2 | P2 Total Goals (Score) | +1000 = H1 (+2000 = H2) |
| 3 | P1 Yellow Cards | +1000 = H1 |
| 4 | P2 Yellow Cards | +1000 = H1 |
| 5 | P1 Red Cards | +1000 = H1 |
| 6 | P2 Red Cards | +1000 = H1 |
| 7 | P1 Corners | +1000 = H1 |
| 8 | P2 Corners | +1000 = H1 |
| 5001 | P1 Penalty Shootout Goals | period = PERIOD_PE |
| 5002 | P2 Penalty Shootout Goals | period = PERIOD_PE |

Defined in: `constants.rs:31-46`

### [Full soccer-scores-stat-keys table] — All stats available via `/api/scores/stat-validation`

| statKey | Name | Notes for settlement |
|---------|------|---------------------|
| 1 | Participant1_Score | Used for NextGoalSide, GoalInWindow |
| 2 | Participant2_Score | Used for NextGoalSide |
| 10 | Participant1_GoalCount | Alternative to key 1 |
| 11 | Participant2_GoalCount | Alternative to key 2 |
| 20 | Participant1_YellowCardCount | Used for NextYellowCard, YellowCardInWindow |
| 21 | Participant2_YellowCardCount | Used for NextYellowCard |
| 30 | Participant1_RedCardCount | Used for RedCardInMatch |
| 31 | Participant2_RedCardCount | — |
| 40 | Participant1_CornerCount | Used for NextCorner, CornerInWindow |
| 41 | Participant2_CornerCount | Used for NextCorner |
| 50 | Participant1_ShotCount | Available for future markets |
| 51 | Participant2_ShotCount | Available for future markets |
| 60 | Participant1_ShotOnTargetCount | Available for future markets |
| 61 | Participant2_ShotOnTargetCount | Available for future markets |
| 80 | Participant1_PossessionPercent | Available for future markets |
| 81 | Participant2_PossessionPercent | Available for future markets |
| 100 | Participant1_FoulCount | Available for future markets |
| 101 | Participant2_FoulCount | Available for future markets |
| 110 | Participant1_YellowCardTotal | Cumulative (incl. 2nd YC → RC) |
| 111 | Participant2_YellowCardTotal | Cumulative |
| 120 | Participant1_RedCardTotal | Cumulative |
| 121 | Participant2_RedCardTotal | Cumulative |
| 150 | Participant1_OffsideCount | Available for future markets |
| 151 | Participant2_OffsideCount | Available for future markets |
| 157 | Participant1_PenaltyShotAttempts | Used for PenaltyShot on-chain |
| 158 | Participant2_PenaltyShotAttempts | Used for PenaltyShot on-chain |
| 159 | Participant1_PenaltyShotGoals | Used for PenaltyShot on-chain |
| 160 | Participant2_PenaltyShotGoals | Used for PenaltyShot on-chain |
| 206 | Participant1_SubstitutionCount | Available for future markets |
| 207 | Participant2_SubstitutionCount | Available for future markets |
| 400 | Participant1_WoodworkCount | Available for future markets |
| 401 | Participant2_WoodworkCount | Available for future markets |
| 620 | Participant1_AttackPossession | Available for future markets |
| 621 | Participant2_AttackPossession | Available for future markets |
| 1001 | Fixture_SportId | Fixture metadata (used in onchain_verification.md example) |
| 1002 | Fixture_CompetitionId | Fixture metadata |
| 1003 | Fixture_StartTime | Fixture metadata |

### Period modifier rule

To access a period-specific stat, add the period offset to the base statKey:
- Base key + `1_000` = H1 value (e.g., P1 H1 Score = 1001)
- Base key + `2_000` = H2 value
- Base key + `3_000` = ET1 value
- Base key + `4_000` = ET2 value
- Base key + `5_000` = PE value

---

## MarketType → StatKey Mapping

| MarketType | statKey(s) | Period | Style | Predicate |
|------------|-----------|--------|-------|-----------|
| NextGoalSide | 1 (P1), 2 (P2) | FULL | Ternary | GreaterThan(0) — which side scored |
| GoalInWindow | 1 (P1) | FULL | Binary | GreaterThan(0) — any goal |
| NextCorner | 7 (P1), 8 (P2) | FULL | Ternary | GreaterThan(0) — which side corner |
| CornerInWindow | 7 (P1) | FULL | Binary | GreaterThan(0) — any corner |
| NextYellowCard | 3 (P1), 4 (P2) | FULL | Ternary | GreaterThan(0) — which side YC |
| YellowCardInWindow | 3 (P1) | FULL | Binary | GreaterThan(0) — any YC |
| RedCardInMatch | 5 (P1) | FULL | Binary | GreaterThan(0) — any RC |
| PenaltyShootoutShot | 5001 (P1), 5002 (P2) | PE | Ternary | GreaterThan(0) — which side scored |
| PenaltyShot | 157 (P1), 159 (P1 goals) | FULL | Binary | Two-stat: attempts - goals > 0 = Missed |
| VARCheck | — | — | Off-chain | No statKey available |

---

## TxOracle selected PDAs (for CPI)

| Account | Seeds | Notes |
|---------|-------|-------|
| `daily_odds_merkle_roots` | `["daily_odds_merkle_roots", epochDay (2 bytes LE)]` | Odds data |
| `daily_scores_merkle_roots` | `["daily_scores_merkle_roots"]` | Score data (validate_stat) |
| `pricing_matrix` | `["pricing_matrix"]` | Subscription pricing |
| `token_treasury_pda` | `["token_treasury_pda"]` | Token treasury |

---

## Network Endpoints

| Service | URL |
|---------|-----|
| Solana Devnet RPC | `https://api.devnet.solana.com` |
| TxLINE Devnet API | `https://txline-dev.txodds.com` |
| TxLINE Mainnet API | `https://txline.txodds.com` |
