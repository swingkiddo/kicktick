# KickTick — Agent Workflows

> Common scenarios an agent will execute during development.

---

## 1. Full Deploy Cycle (Anchor → Devnet)

```bash
# 1. Build
anchor build

# 2. Deploy (deploy.sh sets --with-compute-unit-price 10000)
./deploy.sh

# 3. Copy new IDL to client
cp target/idl/kicktick.json kicktick/client/src/idl/
cp target/types/kicktick.ts kicktick/client/src/types/

# 4. Update program ID in:
#    - programs/kicktick/src/lib.rs:8
#    - frontend/lib/constants.ts:10
#    - relayer/.env (KICKTICK_PROGRAM_ID)

# 5. Run tests
anchor test --skip-deploy
```

**Key files changed:**
- `lib.rs:8` — `declare_id!("...")`
- `frontend/lib/constants.ts:10` — `kicktickProgramId`
- `relayer/src/config.ts:27` — `KICKTICK_PROGRAM_ID` env

---

## 2. Add New Market Type

**Current Phase 1 market types** (in `state/round.rs:6-19`):
```rust
// On-chain (CPI validate_stat)
NextGoalSide, GoalInWindow, NextCorner, CornerInWindow,
NextYellowCard, YellowCardInWindow, RedCardInMatch, PenaltyShootoutShot

// Off-chain (relayer sets outcome)
PenaltyShot, VARCheck
```

**To add a new type:**
1. Add variant to `MarketType` enum in `state/round.rs`
2. Add statKey mapping in `settle_round` handler
3. Update TS enum in SDK if exposed
4. Add test case in `tests/kicktick.ts`

---

## 3. Add New Instruction

**Pattern (follow existing 10 instructions in `instructions/`):**

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
pub fn my_new( ... ) -> Result<()> {
    instructions::my_new::handler(ctx, ...)
}
```

---

## 4. CPI Integration (for Phase 1 settlement)

**Implemented:** `settle_round` calls `txoracle::cpi::validate_stat` with `stat_a`, `stat_b`, `predicate`, proof accounts.

**Accounts needed:**
- `txoracle_program` — TxOracle program ID
- `daily_scores_merkle_roots` — TxOracle PDA `["daily_scores_merkle_roots"]`
- `daily_odds_merkle_roots` — TxOracle PDA `["daily_odds_merkle_roots", epochDay]`
- Proof accounts (item trees, main tree)

**Validated by:** `relayer/src/cpi-spike.ts` — full proof format documented.

---

## 5. Test a Market Lifecycle

```bash
# Run Anchor tests
anchor test --skip-deploy

# Or via yarn
cd kicktick && yarn test
```

**Test flow** (`kicktick/tests/kicktick.ts`):
1. init_config (bootstrap Config PDA)
2. init_match (fixture, home/away teams)
3. open_round (MarketType, lock/deadline)
4. place_bet YES (native SOL)
5. settle_offchain round (VARCheck, winner=1)
6. claim_winnings for YES winner
7. Verify: round.winner - 1 maps to position.side (0=YES,1=NO,2=abstain)

**To add test for new market types:**
- Create fixture with specific `market_type`
- Place bets
- Settle with `settle_odds_value` that triggers YES/NO
- Assert expected outcome

---

## 6. Debug Transaction Failure

**Common error codes (Anchor errors):**

| Code | Name | Likely cause | Fix |
|------|------|-------------|-----|
| 6003 | `InvalidFixtureId` | fixture_id <= 0 | Pass positive fixture_id |
| 6004 | `InvalidDuration` | lock/deadline not in 15-300 | Check args |
| 6005 | `RoundNotOpen` | round not Open | Check round.status |
| 6006 | `DeadlinePassed` | now >= expires_at | Create longer round |
| 6007 | `ZeroAmount` | amount = 0 | Pass amount > 0 |
| 6008 | `InvalidSide` | side > 2 | Use 0/1/2 |
| 6011 | `AlreadyClaimed` | double claim | Check position.claimed |
| 6012 | `NotWinner` | wrong outcome side | Check winner mapping (winner-1 = side) |
| 6013 | `FinalityDelayNotMet` | confirm too early | Wait 60s after settle |

**Debug commands:**
```bash
# Check account data
solana account <PDA> --output json --url devnet

# Get program logs
solana confirm -v <TX_SIGNATURE> --url devnet
```

---

## 7. TxLINE API Auth Flow

```
1. POST /auth/guest/start  →  JWT
2. POST /api/token/activate (with signed message)  →  API token
3. All subsequent requests: Header "Authorization: Bearer <JWT>"
                            Header "X-Api-Token: <API_TOKEN>"
```

**Implemented in:** `relayer/src/txline-auth.ts` (uses `@swingkiddo/txodds-client` SDK)

**Test script:** `scripts/txline-test.ts` — full flow with devnet faucet

---

## 8. Run CPI Spike Test

```bash
cd relayer
# Set env vars
export TXLINE_JWT=<your_jwt>
export TXLINE_API_TOKEN=<your_token>

# Run spike test
npx ts-node src/cpi-spike.ts
```

This validates:
- TxLINE API returns well-formed `StatValidationResult`
- Proof format matches CPI expectations
- PDA derivation matches txoracle seeds
- Programs exist on devnet

---

## 9. Verify Token Mints

```bash
cd relayer
npx ts-node src/verify-tokens.ts
```

Expected output:
```
✅ TxL: 4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG
   Program: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb (Token-2022)
   Decimals: 9

✅ USDT: ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh
   Program: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (Token)
```

---

## 10. Run Full TxLINE Integration Test

```bash
cd scripts
npx ts-node txline-test.ts
```

Tests: faucet USDT, auth, subscription, fixtures, odds snapshot, SSE stream (3 events timeout), stat-validation, scores stream.

---

## 11. Update Client SDK Program ID

The IDL embedded in `market-manager.ts:68-228` uses a placeholder `PROGRAM_ID` at line 230.

After deploy, update:
1. `program_id` in `openclaw.json` or env
2. `frontend/lib/constants.ts:10` — `kicktickProgramId`
3. `relayer/.env` — `KICKTICK_PROGRAM_ID`
4. `kicktick/Anchor.toml:8` — `kicktick = "..."`

---

## 12. Frontend Development (Current State)

**Current:** Demo data only. No on-chain integration yet.

**Components use hardcoded demo markets** in `app/page.tsx`.

**To connect to on-chain:**
1. Replace demo data with `KickTickManager` calls
2. Connect wallet via `WalletContext.tsx`
3. Use `Connection` to devnet for account fetches
4. Add WebSocket listener to `relayer/ws-server.ts`
