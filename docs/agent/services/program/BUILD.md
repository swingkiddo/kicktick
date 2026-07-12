---
id: program-build
type: howto
title: "Build & Test"
service: program
depends_on:
  - program-readme
related_to:
  - program-instructions
  - program-deploy
  - operations-workflows
tags: [build, test, debug]
---

# Build & Test

## Build

Builds are performed through the repository scripts:

```bash
./scripts/build.sh contracts
```

The contracts image contains the Anchor toolchain. Use the contracts container
for interactive diagnostics when needed.

### Update Program ID

After build, update program ID in 4 places:

| File | Field |
|------|------|-------|
| `programs/kicktick/src/lib.rs` | `declare_id!("...")` |
| `relayer/config/constants.json` or relayer `.env` | `kicktickProgramId` / `KICKTICK_PROGRAM_ID` |
| `Anchor.toml` | `[programs.localnet]` and `[programs.devnet]` |

---

## Deploy

See [DEPLOY.md](./DEPLOY.md) for deployment instructions.

---

## Test

Run tests through the contracts container. The repository test setup starts a
fresh local validator, deploys the program, initializes Config, and shares the
provider with the test files.

```bash
./scripts/run.sh contracts
docker exec -it kicktick-contracts bash
npm test
```

### Test coverage

- `tests/kicktick.ts` covers Config, user accounts, deposits, and withdrawals.
- `tests/market.ts` covers market initialization, locking, off-chain resolution,
  confirmation, voiding, and lifecycle errors.
- `tests/standalone-validator.ts` covers 20-wallet deposits, complete-set
  binary settlement, share trades, positions, volume, and fill sequence.

### Adding Tests for New Market Types

- Create a unique fixture ID and market sequence.
- Use `initMarket` with the desired `MarketType` and `MarketParams`.
- Use complete-set or share-trade settlement for CLOB behavior.
- Resolve with an oracle proof or `resolveMarketOffchain` as appropriate.
- Assert Market status, winner, shares, collateral, volume, and fill sequence.

---

## Debug

### Common Error Codes

| Code | Name | Likely Cause | Fix |
|------|------|-------------|-----|
| 6003 | `InvalidFixtureId` | fixture_id <= 0 | Pass positive fixture_id |
| 6004 | `InvalidDuration` | lock/deadline not in 15-300s | Check args within range |
| — | `MarketNotOpen` | market status is not Open | Check `market.status` before locking or trading |
| — | `MarketNotLocked` | market is not Locked | Lock before resolution |
| — | `MarketNotResolved` | resolution state is missing | Resolve before confirmation or cleanup |
| — | `UnauthorizedRelayer` | signer is not Config relayer | Check Config.relayer |
| — | `InvalidFillSequence` | fill is not next in sequence | Reconcile on-chain market state |
| 6007 | `ZeroAmount` | amount = 0 | Pass amount > 0 |
| — | `InvalidOutcomeIndex` | outcome index is outside market range | Use `0..outcome_count` |
| — | `AlreadyClaimed` | position was already claimed | Check `position.claimed` |
| — | `NotWinner` | cleanup called for a winning position | Claim winners; clean losers |
| — | `InsufficientBalance` | user collateral is unavailable | Deposit or wait for a release |

### Debug Commands

```bash
# Check account data
solana account <PDA> --output json --url devnet

# Get transaction logs
solana confirm -v <TX_SIGNATURE> --url devnet

# Check program logs
solana logs --url devnet
```

### CPI Debug

For `resolve_market_with_proof` CPI failures:
- Verify txoracle program exists on devnet: `solana program show 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J --url devnet`
- Check proof accounts match txoracle PDA seeds
- Run the CPI spike inside the relayer container when debugging TxOracle integration.

---

## Add New Instruction

Follow existing pattern in `instructions/`:

```rust
// 1. Define accounts struct in instructions/<name>.rs
#[derive(Accounts)]
pub struct MyNewInstruction<'info> { ... }

// 2. Add handler
pub fn handler(ctx: Context<...>, ...) -> Result<()> { ... }

// 3. Re-export in instructions/mod.rs
pub mod my_new;
pub use my_new::*;

// 4. Wire in lib.rs program function
pub fn my_new(ctx: Context<MyNewInstruction>, ...) -> Result<()> {
    instructions::my_new::handler(ctx, ...)
}
```

---

## Add New Market Type

Current types in `state/market.rs`:

```rust
// On-chain (CPI validate_stat)
NextGoalSide, GoalInWindow, NextCorner, CornerInWindow,
NextYellowCard, YellowCardInWindow, RedCardInMatch, PenaltyShootoutShot

// Off-chain (relayer sets outcome)
PenaltyShot, VARCheck
```

To add:
1. Add a variant to `MarketType` in `state/market.rs`.
2. Update `Market::outcome_count_for` and `requires_oracle`.
3. Add the stat/predicate mapping in `instructions/oracle.rs` if it is
   oracle-backed.
4. Update the relayer market definitions/triggers.
5. Add coverage to `tests/market.ts` and settlement coverage if needed.
