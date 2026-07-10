---
id: operations-troubleshooting
type: howto
title: "Troubleshooting Guide"
service: operations
depends_on:
  - program-constants
related_to:
  - operations-workflows
  - program-build
tags: [troubleshooting, errors, debug]
---

# Troubleshooting Guide

## Error Codes

All error codes defined in `kicktick/programs/kicktick/src/errors.rs`:

| Code | Name | Message |
|------|------|---------|
| 6000 | `Unauthorized` | only admin can call this |
| 6001 | `ConfigAlreadyInitialized` | Config already initialized |
| 6002 | `ConfigNotInitialized` | Config not initialized |
| 6003 | `MatchAlreadyExists` | Match already exists |
| 6004 | `MatchNotFound` | Match not found |
| 6005 | `MatchNotActive` | Match not active |
| 6006 | `InvalidFixtureId` | Invalid fixture ID |
| 6007 | `RoundAlreadyExists` | Round already exists |
| 6008 | `RoundNotFound` | Round not found |
| 6009 | `RoundNotOpen` | Round not open |
| 6010 | `RoundAlreadySettled` | Round already settled |
| 6011 | `RoundNotSettled` | Round not settled |
| 6012 | `RoundNotConfirmable` | Round not confirmable yet |
| 6013 | `RoundAlreadyConfirmed` | Round already confirmed |
| 6014 | `InvalidMarketType` | Invalid market type |
| 6015 | `MarketTypeNotSupported` | Market type not supported for on-chain settlement |
| 6016 | `InvalidDuration` | Invalid round duration (must be 15-300 seconds) |
| 6017 | `DeadlinePassed` | Round deadline has passed |
| 6018 | `RoundStillActive` | Round still active |
| 6019 | `FinalityDelayNotMet` | Finality delay not met |
| 6020 | `ZeroAmount` | Bet amount must be greater than zero |
| 6021 | `InvalidSide` | Invalid bet side |
| 6022 | `InsufficientLiquidity` | Insufficient sponsor liquidity |
| 6023 | `SponsorNotFound` | Sponsor not found |
| 6024 | `MinLiquidityNotMet` | Minimum liquidity not met |
| 6025 | `PositionNotFound` | Position not found |
| 6026 | `AlreadyClaimed` | Position already claimed |
| 6027 | `NotWinner` | Not a winner |
| 6028 | `InvalidSettlementMethod` | Cannot settle off-chain market type on-chain |
| 6029 | `CpiFailed` | CPI call to txoracle failed |

Note: Error codes continue beyond 6029. Check `errors.rs` for full list.

## Common Errors & Fixes

| Code | Name | Likely Cause | Fix |
|------|------|-------------|-----|
| 6006 | `InvalidFixtureId` | fixture_id <= 0 | Pass positive fixture_id |
| 6016 | `InvalidDuration` | lock/deadline not in 15-300s | Check args within range |
| 6009 | `RoundNotOpen` | round status not Open | Check round.status before betting |
| 6017 | `DeadlinePassed` | now >= expires_at | Create round with longer deadline |
| 6020 | `ZeroAmount` | amount = 0 | Pass amount > 0 |
| 6021 | `InvalidSide` | side > 2 | Use 0 (YES), 1 (NO), or 2 (abstain) |
| 6026 | `AlreadyClaimed` | double claim attempt | Check position.claimed before claiming |
| 6027 | `NotWinner` | wrong outcome side | Check winner mapping: winner-1 = side |
| 6019 | `FinalityDelayNotMet` | confirm too early | Wait 60s after settle before confirm |

## Debug Commands

### Check Account Data

```bash
solana account <PDA> --output json --url devnet
```

Example:
```bash
# Check Config PDA
solana account $(solana address -k ~/.config/solana/id.json) --output json --url devnet
```

### Get Transaction Logs

```bash
solana confirm -v <TX_SIGNATURE> --url devnet
```

### Check Program Logs

```bash
solana logs --url devnet
```

### Verify Program Deployment

```bash
solana program show HrMUXZQ7WQ5uNnUWvf5bm2ZgA3En6VBmip78vLSdREqg --url devnet
solana program show 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J --url devnet
```

### Check Token Mints

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

## Relayer Crank Errors

### `TxODDS API 404 on /scores/stat-validation: ... could not be found ...`

**Symptom:** Crank emits `settle_onchain` status `failed` with upstream 404 immediately after a market-trigger event. Body contains "A valid, processed scores record for (fixtureId, seq) could not be found" or "processed scores record".

**Cause:** Race between SSE event arrival and TxODDS merklization. The SSE `Seq` is observed before the backend has merklized the corresponding scores record into a Merkle batch. `/stat-validation` is the only API that requires a fully-processed record.

**Fix (already shipped):** Crank wraps `ProofGatherer.gatherProof` in `gatherProofWithRetry` (`relayer/src/settlement/crank.ts`). On 404, only `ProofNotReadyError` triggers retry — 4 attempts, backoff `0/1/2/4s` (≤8s total budget). Other upstream errors fail fast.

**Tuning:** Override `proofMaxAttempts` and `proofBackoffMs` via `CrankOptions` if backend lag exceeds 8s in your region.

**Verify:**
```bash
# 1. Spot-check the seq with curl using a known-processed record
curl -sS "https://txline-dev.txodds.com/api/scores/updates/<fixtureId>" \
  -H "Authorization: Bearer $TXLINE_JWT" \
  -H "X-Api-Token: $TXLINE_API_TOKEN" | jq '.[].seq' | tail -5
# 2. Replay a corner event for that fixture, observe 8s retry path in relayer logs.
```

**Related:** `relayer/src/settlement/proof-gatherer.ts:ProofNotReadyError`, `relayer/src/settlement/crank.ts:gatherProofWithRetry`.

## CPI Debug

For `settle_round` CPI failures:

1. **Verify txoracle program exists:**
   ```bash
   solana program show 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J --url devnet
   ```

2. **Check proof accounts:** Verify PDA derivation matches txoracle seeds:
   - `daily_scores_merkle_roots`: `["daily_scores_merkle_roots"]`
   - `daily_odds_merkle_roots`: `["daily_odds_merkle_roots", epochDay (2 bytes LE)]`

3. **Run CPI spike test:**
   ```bash
   cd relayer
   export TXLINE_JWT=<your_jwt>
   export TXLINE_API_TOKEN=<your_token>
   npx ts-node src/cpi-spike.ts
   ```

   This validates:
   - TxLINE API returns well-formed `StatValidationResult`
   - Proof format matches CPI expectations
   - PDA derivation matches txoracle seeds
   - Programs exist on devnet

## Winner Mapping

Round winner values map to position sides:

| Winner Value | Side | Meaning |
|--------------|------|---------|
| 0 | — | Void (no winner) |
| 1 | 0 (YES) | YES wins |
| 2 | 1 (NO) | NO wins |
| 3 | 2 (abstain) | Abstain wins |

Formula: `position.side = winner - 1`

## Related Docs

- `program/BUILD.md` — build, deploy, test instructions
- `integration/ENVIRONMENT.md` — program IDs, network config
- `program/ARCHITECTURE.md` — PDA account model
