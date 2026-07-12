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

Sub-minute prediction markets on Solana. Trustless market resolution via CPI to the TxOracle program. Users trade USDC-denominated shares on real-time soccer events through CLOB markets with on-chain Merkle proof verification.

## Key Concepts

### USDC collateral
User collateral, CLOB settlement, and payouts use the configured SPL USDC mint.
The mint, decimals, and token program are captured in `Config`; user and market
vaults are SPL token accounts.

### PDA Types
| PDA | Seeds | Purpose |
|-----|-------|---------|
| Config | `["config"]` | Global config, admin, oracle program ID, relayer |
| Match_ | `["match", fixture_id]` | Match metadata and lifecycle compatibility fields |
| Market | `["market", fixture_id, market_type, market_seq]` | Tradable market state, expiry, resolution |
| Position | `["position", market, owner]` | User position per market |
| UserAccount / UserVault | `["user", owner]` / `["user_vault", owner]` | Wallet collateral bookkeeping and custody |
| MarketVault | `["market_vault", market]` | Market collateral and complete-set funds |

Full details: `program/ARCHITECTURE.md`

### Instructions

| Instruction | Purpose |
|---|---|
| `init_config` / `set_relayer` | Bootstrap and rotate global authority |
| `init_match` | Create fixture metadata and match vault |
| `init_user` / `deposit` / `withdraw` | Manage user collateral |
| `init_market` / `lock_market` | Create and freeze a market when its outcome is known or its deadline expires |
| `resolve_market_with_proof` | Resolve through TxOracle CPI |
| `resolve_market_offchain` | Resolve trusted off-chain market types |
| `confirm_market` / `void_market` | Finalize or void a market |
| `settle_complete_set` | Create a binary complete set for a fill |
| `settle_share_trade` | Transfer shares between buyer and seller |
| `split` / `merge` | Convert exact collateral to/from binary YES+NO complete sets |
| `claim` | Pay winning/voided shares to a user |
| `cleanup_position` / `close_market_vault` | Reclaim terminal account rent |

### Settlement Models

- **On-chain:** `resolve_market_with_proof` → CPI `txoracle::validate_stat` with Merkle proof accounts. Binary/ternary predicates per MarketType.
- **Off-chain:** `resolve_market_offchain` → relayer sets outcome for PenaltyShot and VARCheck.
- **Confirm:** `confirm_market` finalizes a market after resolution.
- **Locking:** A market is open for trading while its outcome is uncertain. The
  relayer should lock it immediately when an event makes the outcome
  determinable; after the deadline, any caller may perform the timeout lock.
- **CLOB trading:** The relayer matches signed orders off-chain and submits
  complete-set or share-trade fills through the relayer-authorized instructions.
- **Exact reserves:** BUY orders store a ceil-based `reserved_collateral` value;
  fills, cancellation, and expiry consume or release that stored amount exactly.
- **Binary CTF scope:** split, merge, order creation, and CLOB settlement support
  binary YES/NO markets only in this release.
- **Payout:** `claim` → winning or voided share payout from the MarketVault to the UserVault.
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
├── state/
│   ├── config.rs — Config PDA
│   ├── match_.rs — Match_ PDA
│   ├── market.rs — Market PDA, MarketType, MarketStatus, MarketParams
│   ├── position.rs — Position PDA with outcome shares
│   ├── user_account.rs — UserAccount PDA
└── instructions/
    ├── mod.rs (22 lines) — re-exports
    ├── init_config.rs (32 lines)
    ├── init_match.rs
    ├── market.rs — market lifecycle and relayer authority
    ├── user.rs — user account, deposit, withdraw
    ├── trade.rs — complete-set and share-trade settlement
    ├── oracle.rs — proof settlement
    ├── redeem.rs — claim, cleanup, vault close
    └── token.rs — SPL token transfers and price-cost math
```

## Tests

- Test files: `kicktick/tests/kicktick.ts`, `kicktick/tests/market.ts`,
  `kicktick/tests/standalone-validator.ts`
- Flows cover Config/user collateral, market lifecycle, CLOB complete-set
  settlement, share trades, voiding, cleanup, and error conditions.
- Run through the repository's Docker workflow; do not use host-side Anchor
  commands as the operational path.

## Related Docs

- `program/ARCHITECTURE.md` — full PDA account model
- `program/BUILD.md` — build, test, debug
- `program/DEPLOY.md` — deploy to devnet/mainnet
- `operations/TROUBLESHOOTING.md` — error codes and fixes
