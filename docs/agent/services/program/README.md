---
id: program-readme
type: overview
title: "Anchor Program Overview"
service: program
depends_on: []
related_to:
  - program-architecture
  - program-instructions
  - program-constants
tags: [program, overview, PDA]
---

# Anchor Program Overview

## Purpose

Sub-minute prediction markets on Solana. Trustless market resolution via CPI to the TxOracle program. Users trade native SOL on real-time soccer events through CLOB markets with on-chain Merkle proof verification.

## Key Concepts

### Native SOL
No SPL tokens. All bets, payouts, and sponsor liquidity use native SOL (lamports).

### PDA Types
| PDA | Seeds | Purpose |
|-----|-------|---------|
| Config | `["config"]` | Global config, admin, oracle program ID, relayer |
| Match_ | `["match", fixture_id]` | Match lifecycle, team names, fixture vault data |
| Market | `["market", fixture_id, market_type, market_seq]` | Tradable market state, expiry, resolution |
| Position | `["position", market, owner]` | User position per market |
| UserAccount / UserVault | `["user", owner]` / `["user_vault", owner]` | Wallet collateral bookkeeping and custody |
| MarketVault | `["market_vault", market]` | Market collateral and complete-set funds |
| SponsorVault | `["sponsor_vault"]` | Global sponsor liquidity pool |

Full details: `program/ARCHITECTURE.md`

### Instructions

| # | Instruction | Purpose |
|---|-------------|---------|
| 1 | `init_config` | Initialize global Config PDA (one-time) |
| 2 | `init_market` | Create a market from a TxLINE fixture and market type |
| 3 | `init_user` | Create user collateral bookkeeping accounts |
| 4 | `deposit` | Deposit SOL into the user vault |
| 5 | `withdraw` | Withdraw available SOL from the user vault |
| 6 | `confirm_market` | Confirm a resolved market |
| 7 | `resolve_market_with_proof` | Resolve a market via TxOracle Merkle proof CPI |
| 8 | `resolve_market_offchain` | Resolve off-chain markets like PenaltyShot and VARCheck |
| 9 | `close_market_vault` | Close the market vault after resolution |
| 10 | `claim` | Claim payout for a winning position |
| 11 | `cleanup_position` | Clean up a settled or expired position |
| 12 | `set_relayer` | Rotate the trusted relayer authority |

### Settlement Models

- **On-chain:** `resolve_market_with_proof` → CPI `txoracle::validate_stat` with Merkle proof accounts. Binary/ternary predicates per MarketType.
- **Off-chain:** `resolve_market_offchain` → relayer sets outcome for PenaltyShot and VARCheck.
- **Confirm:** `confirm_market` finalizes a market after resolution.
- **Payout:** `claim` → pro-rata distribution from the market vault.
- **Cleanup:** `cleanup_position` and `close_market_vault` clear finished market state.

### Market Types

**On-chain (CPI validate_stat):**
- NextGoalSide, GoalInWindow, NextCorner, CornerInWindow
- NextYellowCard, YellowCardInWindow, RedCardInMatch, PenaltyShootoutShot

**Off-chain (relayer sets outcome):**
- PenaltyShot, VARCheck

## File Structure

```
programs/kicktick/src/
├── lib.rs — module router
├── constants.rs (48 lines) — seeds, limits, StatKeys, CPI discriminator
├── errors.rs — error codes
├── state/ (6 files)
│   ├── mod.rs (11 lines) — re-exports
│   ├── config.rs (15 lines) — Config PDA
│   ├── match_.rs (47 lines) — Match_ PDA
│   ├── market.rs — Market PDA, MarketType, MarketStatus, MarketParams
│   ├── position.rs (16 lines) — Position PDA
│   └── vault.rs (12 lines) — SponsorVault / vault helpers
└── instructions/
    ├── mod.rs (22 lines) — re-exports
    ├── init_config.rs (32 lines)
    ├── init_market.rs
    ├── init_user.rs
    ├── deposit.rs / withdraw.rs
    ├── resolve_market_with_proof.rs
    ├── resolve_market_offchain.rs
    ├── confirm_market.rs
    ├── claim.rs
    ├── cleanup_position.rs
    ├── close_market_vault.rs
    └── set_relayer.rs
```

## Tests

- Test file: `kicktick/tests/kicktick.ts`
- Flow: init_config → init_market → deposit → resolve_market_* → confirm_market → claim
- Run: `anchor test --skip-deploy`

## Related Docs

- `program/ARCHITECTURE.md` — full PDA account model
- `program/BUILD.md` — build, test, debug
- `program/DEPLOY.md` — deploy to devnet/mainnet
- `operations/TROUBLESHOOTING.md` — error codes and fixes
