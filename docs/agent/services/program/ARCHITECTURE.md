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
├── collateral_mint: Pubkey
├── collateral_decimals: u8
├── collateral_token_program: Pubkey
└── bump: u8
```

`finality_delay` is retained for compatibility with the Config PDA already
initialized on devnet. The current initialization sets it to `0`. Collateral
configuration is immutable after initialization and is used by every token
vault constraint.

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
└── SPL token account (configured collateral mint; authority = UserAccount)
```

`deposit` moves configured USDC into the user vault and credits `available_balance`.
`withdraw` moves available USDC back to the user's token account. CLOB settlement consumes or
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

`MarketVault` is an SPL token account holding market collateral, complete-set
funds, and payout funds. Its authority is the Market PDA.

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
not a direct YES/NO collateral amount.

## Order PDA

**Seeds:** `["order", owner, nonce (u64 LE)]`

```text
OrderAccount
├── owner: Pubkey
├── market: Pubkey
├── side: Buy | Sell
├── outcome_index: u8
├── price_bps: u16
├── quantity: u64
├── remaining_quantity: u64
├── reserved_collateral: u64
├── nonce: u64
├── expires_at: i64
├── status: Open | Partial | Filled | Cancelled | Expired
└── bump: u8
```

BUY orders reserve `ceil(quantity × price_bps / 10_000)` USDC base units.
`reserved_collateral` is consumed exactly as fills settle and any remainder is
released on a full fill, cancellation, or expiry. SELL orders reserve shares in
`Position.locked_shares`; locked shares cannot be transferred or merged.

The owner creates and may cancel an Order PDA. The configured relayer may
expire it after `expires_at` or cancel it after the market leaves `Open`.
Cancellation and expiry release the exact remaining BUY reserve or SELL locked
shares before the Order PDA is closed. Owner cancellation and post-lock cleanup
return account rent to the owner; relayer expiry closes the account to the
relayer.

The addition of `reserved_collateral` expanded the serialized account to 118
bytes including the Anchor discriminator. This is a breaking account-layout
change: deployments require fresh Order PDA state.

## Account summary

| Account | Seeds | Type | Purpose |
|---|---|---|---|
| Config | `config` | Anchor account | Admin, relayer, oracle and global settings |
| Match_ | `match`, fixture ID | Anchor account | Fixture metadata and legacy aggregate fields |
| UserAccount | `user`, owner | Anchor account | Available and reserved user collateral |
| UserVault | `user_vault`, owner | SPL token account | User USDC custody |
| Market | `market`, fixture ID, type, sequence | Anchor account | CLOB market lifecycle and fill accounting |
| MarketVault | `market_vault`, market | SPL token account | Market collateral and payouts |
| Position | `position`, market, owner | Anchor account | Outcome shares and claim state |
| OrderAccount | `order`, owner, nonce | Anchor account | Signed order terms and exact remaining reserve |
