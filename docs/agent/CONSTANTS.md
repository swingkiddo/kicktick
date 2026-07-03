# KickTick — Constants & Seeds (Phase 1)

> Single source of truth for addresses, seeds, config values. Read before any on-chain interaction.

---

## Program IDs

| Component | Devnet | Mainnet |
|-----------|--------|---------|
| **KickTick** | `CCmcpUZttSJqUabxBcyvHp4uC89EkrXce5YSEvRgE7tc` | TBD |
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
| Spike threshold (oracle) | **15%** | `client/txodds-oracle.ts:394` |
| Spike window (oracle) | **60 seconds** | `client/txodds-oracle.ts:397` |

---

## StatKey Map (TxLINE Soccer Feed v1.0)

| Key | Stat | Period modifier |
|-----|------|----------------|
| 1 | P1 Total Goals | +1000 = H1 (+2000 = H2) |
| 2 | P2 Total Goals | +1000 = H1 (+2000 = H2) |
| 3 | P1 Total Yellow Cards | +1000 = H1 |
| 4 | P2 Total Yellow Cards | +1000 = H1 |
| 5 | P1 Total Red Cards | +1000 = H1 |
| 6 | P2 Total Red Cards | +1000 = H1 |
| 7 | P1 Total Corners | +1000 = H1 |
| 8 | P2 Total Corners | +1000 = H1 |
| 5001 | P1 Penalty Shootout Goals | PE period |
| 5002 | P2 Penalty Shootout Goals | PE period |

Defined in: `constants.rs:31-46`

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

---

## Error Codes (Phase 1)

| Code | Name | Message |
|------|------|---------|
| 6000 | `Unauthorized` | only admin |
| 6001 | `ConfigAlreadyInitialized` | |
| 6002 | `ConfigNotInitialized` | |
| 6003 | `InvalidFixtureId` | |
| 6004 | `InvalidDuration` | 15-300s |
| 6005 | `RoundNotOpen` | |
| 6006 | `DeadlinePassed` | |
| 6007 | `ZeroAmount` | amount > 0 |
| 6008 | `InvalidSide` | side <= 2 |
| 6009 | `Overflow` | |
| 6010 | `DivisionByZero` | |
| 6011 | `AlreadyClaimed` | |
| 6012 | `NotWinner` | |
| 6013 | `InvalidSettlementMethod` | |
| 6014 | `CpiFailed` | |
| 6015 | `PredicateFailed` | |
| 6016 | `FinalityDelayNotMet` | |

Defined in: `errors.rs`

---

## Account Sizes

| Account | Space (bytes) |
|---------|---------------|
| `Config` | 8+32+32+32+8+8+1 = 81 |
| `Match_` | ~250 |
| `Round` | 8+32+8+1+31+1+9+17+1+1+8*7+2+1+1 = 143 |
| `Position` | 8+32+8+8+1+8+1+1 = 65 |

Defined in: `state/config.rs`, `state/match_.rs`, `state/round.rs`, `state/position.rs`
