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
  - relayer-settlement
tags: [troubleshooting, errors, debug, recovery]
---

# Troubleshooting Guide

## Error source of truth

Anchor error names and their numeric codes are defined by declaration order in
`kicktick/programs/kicktick/src/errors.rs`. Do not copy numeric values between
versions without checking that file. The current error families are:

- configuration and authority: `Unauthorized`, `ConfigAlreadyInitialized`,
  `ConfigNotInitialized`, `UnauthorizedRelayer`;
- match and market lifecycle: `MatchAlreadyExists`, `MatchNotFound`,
  `MatchNotActive`, `MarketNotOpen`, `MarketNotLocked`, `MarketNotResolved`,
  `MarketNotTerminal`, `MarketNotConfirmed`, `DeadlinePassed`;
- market and CLOB validation: `InvalidMarketType`, `InvalidOutcomeCount`,
  `InvalidOutcomeIndex`, `InvalidPrice`, `InvalidPriceSum`,
  `InvalidPriceTick`, `QuantityTooSmall`, `InvalidFillSequence`;
- settlement: `OracleResolutionRequired`, `OffchainResolutionRequired`,
  `MarketTypeNotSupported`, `CpiFailed`, `StatKeyMappingNotFound`,
  `MissingProofSequence`, `PredicateFailed`;
- balances and redemption: `ZeroAmount`, `InsufficientBalance`,
  `InsufficientShares`, `InsufficientLiquidity`, `PositionNotFound`,
  `AlreadyClaimed`, `NotWinner`;
- account safety: `Overflow`, `DivisionByZero`, `AlreadyInitialized`,
  `InvalidAccountData`.

## Common Anchor failures

| Error | Likely cause | Fix |
|---|---|---|
| `InvalidFixtureId` | non-positive fixture ID | Use a positive signed i64 fixture ID |
| `InvalidDuration` | deadline outside 15..=300 seconds | Use the program duration limits |
| `MarketNotOpen` | operation targets a locked/terminal market | Read Market status before trading or locking |
| `MarketNotLocked` | resolution attempted before locking | Call `lock_market` first |
| `MarketNotResolved` | claim/cleanup has no winner | Resolve and confirm the market |
| `UnauthorizedRelayer` | signer differs from Config.relayer | Rotate Config or use the configured relayer |
| `InvalidFillSequence` | fill is not the next accepted sequence | Reconcile on-chain `Market.fill_sequence` |
| `InvalidPrice` / `InvalidPriceTick` | price outside 1..99% or not a 1% tick | Use valid bps values |
| `InsufficientBalance` | user collateral is unavailable | Deposit or wait for a prior reservation to release |
| `AlreadyClaimed` | position was already claimed | Inspect Position.claimed |
| `NotWinner` | loser cleanup called for a winning position | Claim the winning position instead |

## Verify deployment and accounts

```bash
solana program show 7Pc2ipKnDya7UKhQVQA2zdateaLpgHGQbyNt34R5dNF4 --url devnet
solana program show 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J --url devnet
solana confirm -v <TX_SIGNATURE> --url devnet
solana account <PDA> --output json --url devnet
```

The KickTick program ID must match `Anchor.toml`, `lib.rs`, the relayer
constants, the relayer IDL address, and any `KICKTICK_PROGRAM_ID` override.

## CPI and proof failures

For `resolve_market_with_proof` failures:

1. Confirm the TxOracle program and `daily_scores_merkle_roots` PDA exist.
2. Confirm that the TxLINE sequence is a processed score sequence, not merely
   the latest SSE message ID.
3. Confirm the proof's stat key, period, fixture summary, and market's captured
   `MarketParams` agree.
4. Inspect `ProofNotReadyError` and retry logs in the relayer container.

The CPI diagnostic is run inside the relayer container:

```bash
docker exec -it kicktick-relayer npx ts-node src/scripts/cpi-spike.ts
```

## Relayer recovery failures

### Market recovery skipped

Check the configured program ID, RPC health, fixture/market sequence, and the
original `init_market` transaction. Do not delete the SQLite row before
determining whether the market exists on chain.

### Fill remains `UNKNOWN`

Keep the reservation. Check the saved transaction signature and compare its
status with the market's on-chain `fill_sequence` before retrying or releasing
the fill.

### Order rejected for a funded wallet

The current MVP can match a local order before every on-chain collateral and
position constraint has been prevalidated. Inspect `UserAccount`, available
balance, market position, and local reservations.

### Test reset restores old state

Do not reset while actions or fills are in flight. The current reset clears
SQLite and in-memory state, so asynchronous work must be drained before reset
hardening is considered complete.

## Token diagnostics

```bash
docker exec -it kicktick-relayer npx ts-node src/scripts/verify-tokens.ts
```

Expected devnet mints:

```text
TxL:  4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG
USDT: ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh
```
