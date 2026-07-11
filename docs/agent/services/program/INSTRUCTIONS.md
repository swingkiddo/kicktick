---
id: program-instructions
type: reference
title: "On-Chain Instructions"
service: program
depends_on:
  - program-architecture
  - program-constants
related_to:
  - program-build
  - integration-data-flow
tags: [instructions, CPI, settlement, clob, market]
---

# KickTick — On-Chain Instructions

The public instruction names below are the Anchor/IDL API. Some Rust source
files retain historical filenames such as `settle_round.rs` and
`settle_offchain_round.rs`; those filenames do not define the public API.

All market funds use native SOL. The relayer is authorized through `Config` for
CLOB settlement and off-chain resolution. Users sign their own collateral and
claim operations.

## Configuration and fixture setup

### `init_config`

Creates the one-per-program Config PDA. The signer becomes `admin` and is also
the initial `relayer`. The instruction derives the TxOracle daily scores roots
PDA and stores the configured oracle program ID.

### `init_match`

Creates a `Match_` account from a positive fixture ID and home/away team names.
The signer must be the Config admin. It also verifies and creates the system-
owned match vault PDA.

Arguments:

```text
fixture_id: i64
home_team: String   // max 64 bytes
away_team: String   // max 64 bytes
```

### `set_relayer`

Admin-only rotation of the relayer authority stored in Config. The new key
cannot be the default public key.

## User collateral

### `init_user`

Creates the user collateral bookkeeping account and its system-owned user vault.

### `deposit`

Transfers native SOL from the user wallet to the user vault and increments
`UserAccount.available_balance`. The amount must be positive.

### `withdraw`

Transfers available native SOL from the user vault back to the user wallet. It
rejects zero amounts and withdrawals larger than the available balance.

## Market lifecycle

### `init_market`

Creates an Open Market and its system-owned MarketVault. The signer must be the
Config admin.

Arguments:

```text
fixture_id: i64
market_type: MarketType
market_seq: u64
params: MarketParams
deadline_seconds: i64  // 15..=300
```

`MarketParams` captures participant, period, and baseline values used later by
oracle proof settlement. Outcome count is derived from the market type: binary
markets have two outcomes and side markets have three.

### `lock_market`

Moves an `Open` market to `Locked`, which rejects further fills. The intended
trigger is event-driven: when an SSE event makes the outcome determinable (for
example, a goal for a next-goal market), the relayer locks immediately before
resolution. If no determining event occurs, the market can be locked after
`expires_at`; after expiry the instruction is permissionless. The instruction
does not implement a fixed 15-second pre-deadline lock window.

### `resolve_market_with_proof`

Resolves an oracle-backed market through CPI to TxOracle `validate_stat`. The
caller supplies the proof accounts and `ValidateStatArgs`. The instruction
checks the market's captured oracle context and moves the market to
`ResolvedPending` when the predicate succeeds.

### `resolve_market_offchain`

Relayer-only resolution for `PenaltyShot` and `VARCheck`. It accepts a zero-
based winner outcome index and moves the market to `ResolvedPending`.

### `confirm_market`

Finalizes a `ResolvedPending` market as `Resolved`. The current Config
`finality_delay` is zero, so confirmation is immediate and is not delayed by
the program.

### `void_market`

Admin-only transition to `Voided`. The market's `void_payout_bps` values define
the proportional payout for all held shares.

## CLOB settlement

The relayer matches signed orders off-chain and submits the resulting fills on
chain. The program validates prices, quantities, user balances, position
ownership, and monotonically increasing `fill_sequence` values.

### `settle_complete_set_binary`

Mints one share of each binary outcome to two owners and debits their user
collateral at the supplied outcome prices. The two prices must sum to the
price scale.

### `settle_complete_set_ternary`

The ternary equivalent for three owners/outcomes. All three prices must satisfy
the market price constraints.

### `settle_share_trade`

Transfers an outcome's shares from seller to buyer and transfers the buyer's
SOL payment to the seller's available balance. The seller must hold enough
unlocked shares and the fill sequence must be the next accepted sequence.

## Redemption and cleanup

### `claim`

User-only payout operation. For a Resolved market it credits the user's UserVault
with the winning shares. For a Voided market it applies `void_payout_bps` to all
shares. The position is marked claimed and then closed.

### `cleanup_position`

Relayer-authorized cleanup for a resolved losing position with no winning
shares. It closes the Position account and decrements `open_positions`.

### `close_market_vault`

Admin-only final cleanup after the market is terminal and positions have been
handled. It closes the MarketVault to the selected recipient.

## Public instruction summary

| Instruction | Authority | Main effect |
|---|---|---|
| `init_config` | First admin | Creates Config |
| `init_match` | Config admin | Creates Match_ and match vault |
| `set_relayer` | Config admin | Rotates relayer |
| `init_user` | User | Creates collateral accounts |
| `deposit` / `withdraw` | User | Moves available SOL |
| `init_market` | Config admin | Creates Open Market and vault |
| `lock_market` | Authority | Freezes market |
| `resolve_market_with_proof` | Resolver | CPI oracle resolution |
| `resolve_market_offchain` | Config relayer | Trusted off-chain resolution |
| `confirm_market` | Caller | Finalizes resolution |
| `void_market` | Config admin | Voids market |
| `settle_complete_set_binary` | Config relayer | Mints binary complete sets |
| `settle_complete_set_ternary` | Config relayer | Mints ternary complete sets |
| `settle_share_trade` | Config relayer | Transfers shares between users |
| `claim` | User | Pays out and closes position |
| `cleanup_position` | Config relayer | Closes losing position |
| `close_market_vault` | Config admin | Closes terminal market vault |
