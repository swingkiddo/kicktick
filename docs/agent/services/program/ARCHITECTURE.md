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
tags: [architecture, PDA, state, seeds, clob]
---

# On-Chain Account Model

The Anchor program is the authoritative ledger for user collateral, market
state, positions, CLOB fills, and settlement. Orders are matched off-chain by
the relayer, but every accepted fill is applied through a relayer-authorized
program instruction.

## Config PDA

**Seeds:** `["config"]`

```text
Config
├── admin: Pubkey
├── relayer: Pubkey
├── txoracle_program_id: Pubkey
├── daily_scores_merkle_roots: Pubkey
├── finality_delay: i64
├── min_liquidity: u64
└── bump: u8
```

`finality_delay` is retained for compatibility with the Config PDA already
initialized on devnet. The current initialization sets it to `0`.

## Match PDA

**Seeds:** `["match", fixture_id (i64 LE)]`

```text
Match_
├── fixture_id: i64
├── status: Pending | Live | Finished | Cancelled
├── home_team: String
├── away_team: String
├── competition_id: i32
├── vault_bump: u8
├── round_counter: u64
├── total_deposited: u64
├── total_sponsored: u64
├── created_at: i64
└── bump: u8
```

The `round_counter` field is retained in the account layout for compatibility;
current market identity is determined by `market_seq` in the Market PDA.

## User collateral accounts

```text
UserAccount  ["user", owner]
├── owner: Pubkey
├── available_balance: u64
├── reserved_balance: u64
├── vault_bump: u8
└── bump: u8

UserVault    ["user_vault", owner]
└── system-owned SOL account
```

`deposit` moves SOL into the user vault and credits `available_balance`.
`withdraw` moves available SOL back to the wallet. CLOB settlement consumes or
credits these balances through the configured relayer.

## Market PDA

**Seeds:** `["market", fixture_id (i64 LE), market_type (u8), market_seq (u64 LE)]`

```text
Market
├── fixture_id: i64
├── market_type: MarketType
├── market_seq: u64
├── params: MarketParams
├── outcome_count: u8
├── status: Open | Locked | ResolvedPending | Resolved | Voided
├── winner: Option<u8>
├── expires_at: i64
├── resolved_at: i64
├── void_payout_bps: [u16; 3]
├── collateral: u64
├── total_volume: u64
├── fill_sequence: u64
├── open_positions: u64
├── vault_bump: u8
└── bump: u8
```

`MarketParams` captures the immutable oracle context at creation:
`participant`, `period`, `baseline_a`, and `baseline_b`.

## Market vault

**Seeds:** `["market_vault", market_pubkey]`

`MarketVault` is a system-owned, zero-data account holding market collateral,
complete-set funds, and payout funds. It is not the match vault and is not
addressed by a Round identifier.

## Position PDA

**Seeds:** `["position", market_pubkey, owner]`

```text
Position
├── owner: Pubkey
├── market: Pubkey
├── shares: [u64; 3]
├── locked_shares: [u64; 3]
├── claimed: bool
└── bump: u8
```

One Position exists per wallet and market. The position stores outcome shares,
not a direct YES/NO bet amount.

## SponsorVault PDA

**Seeds:** `["sponsor_vault"]`

`SponsorVault` remains in the account model for compatibility, but there is no
public sponsor instruction in the current Anchor instruction surface. It must
not be treated as the active CLOB funding path.

## Account summary

| Account | Seeds | Type | Purpose |
|---|---|---|---|
| Config | `config` | Anchor account | Admin, relayer, oracle and global settings |
| Match_ | `match`, fixture ID | Anchor account | Fixture metadata and legacy aggregate fields |
| UserAccount | `user`, owner | Anchor account | Available and reserved user collateral |
| UserVault | `user_vault`, owner | System account | User SOL custody |
| Market | `market`, fixture ID, type, sequence | Anchor account | CLOB market lifecycle and fill accounting |
| MarketVault | `market_vault`, market | System account | Market collateral and payouts |
| Position | `position`, market, owner | Anchor account | Outcome shares and claim state |
| SponsorVault | `sponsor_vault` | Anchor account | Retained compatibility account |
