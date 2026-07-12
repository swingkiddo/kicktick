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

# KickTick — Constants & Seeds

## Program IDs

| Component | Devnet | Source |
|---|---|---|
| KickTick | `LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND` | `Anchor.toml`, `lib.rs`, relayer constants |
| TxOracle | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | `constants.rs` |

The program ID must match the deployed binary and the copied IDL. Mainnet
addresses are not defined by the current project configuration.

## PDA seeds

| Account | Seeds | Purpose |
|---|---|---|
| `Config` | `config` | Global admin, relayer, oracle settings |
| `UserAccount` | `user`, owner | User collateral bookkeeping |
| `UserVault` | `user_vault`, owner | User USDC custody |
| `Match_` | `match`, fixture ID as signed i64 LE | Fixture metadata |
| `Market` | `market`, fixture ID as signed i64 LE, market type byte, market sequence as u64 LE | Tradable market identity |
| `MarketVault` | `market_vault`, Market PDA | Market collateral and payouts |
| `Position` | `position`, Market PDA, owner | User shares for one market |

## Market types and status

```text
MarketType:
NextGoalSide, GoalInWindow, NextCorner, CornerInWindow,
NextYellowCard, YellowCardInWindow, RedCardInMatch,
PenaltyShootoutShot, PenaltyShot, VARCheck

MarketStatus:
Open, Locked, ResolvedPending, Resolved, Voided
```

The first, third, fifth, and eighth market types are ternary; the other market
types are binary. `PenaltyShot` and `VARCheck` use relayer-authorized off-chain
resolution. The remaining types require oracle proof resolution.

Market resolution may still understand ternary market types, but the current
CLOB order and complete-set instructions accept binary markets only.

## Numeric constraints

| Parameter | Value | Source |
|---|---:|---|
| Minimum market duration | 15 seconds | `MIN_MARKET_DURATION` |
| Maximum market duration | 300 seconds | `MAX_MARKET_DURATION` |
| Maximum outcomes | 3 | `MAX_OUTCOMES` |
| Price scale | 10,000 bps | `PRICE_SCALE_BPS` |
| Price tick | 100 bps | `PRICE_TICK_BPS` |
| Minimum price | 100 bps | `MIN_PRICE_BPS` |
| Maximum price | 9,900 bps | `MAX_PRICE_BPS` |
| Minimum trade quantity | 100 shares | `MIN_TRADE_QUANTITY` |
| Minimum configured liquidity | 10,000 USDC base units | `MIN_MARKET_LIQUIDITY_BASE_UNITS` |

`finality_delay` remains in Config for account compatibility and is initialized
to zero by the current program. `DEFAULT_LOCK_SECONDS` is also retained for
compatibility with older round terminology; current markets do not close on a
fixed pre-deadline lock timer. They lock when the outcome becomes determinable
or after the deadline.

## Period constants

| Constant | Value |
|---|---:|
| `PERIOD_H1` | 0 |
| `PERIOD_H2` | 1000 |
| `PERIOD_ET1` | 2000 |
| `PERIOD_ET2` | 3000 |
| `PERIOD_PE` | 5000 |

These values are the current code values. `PERIOD_H1 = 0` is retained as the
program's full-match/default period representation; do not silently substitute
the values from external TxLINE documentation.

## Stat keys used by the program

| Constant | Value | Meaning |
|---|---:|---|
| `STATKEY_P1_GOALS` | 1 | Participant 1 goals |
| `STATKEY_P2_GOALS` | 2 | Participant 2 goals |
| `STATKEY_P1_YC` | 3 | Participant 1 yellow cards |
| `STATKEY_P2_YC` | 4 | Participant 2 yellow cards |
| `STATKEY_P1_RC` | 5 | Participant 1 red cards |
| `STATKEY_P2_RC` | 6 | Participant 2 red cards |
| `STATKEY_P1_CORNERS` | 7 | Participant 1 corners |
| `STATKEY_P2_CORNERS` | 8 | Participant 2 corners |
| `STATKEY_P1_PE` | 5001 | Participant 1 penalty shootout goals |
| `STATKEY_P2_PE` | 5002 | Participant 2 penalty shootout goals |

The exact stat/predicate mapping is implemented in the oracle settlement
handler and must be kept aligned with its `ValidateStatArgs` construction.
