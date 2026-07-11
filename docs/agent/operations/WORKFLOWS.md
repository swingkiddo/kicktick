---
id: operations-workflows
type: howto
title: "Agent Workflows"
service: operations
depends_on:
  - program-build
related_to:
  - program-instructions
  - operations-troubleshooting
tags: [workflows, deploy, test, debug, clob]
---

# KickTick — Agent Workflows

## 1. Build and deploy the program

All builds and deployments use Docker-backed repository scripts:

```bash
./scripts/build.sh contracts
./scripts/deploy.sh devnet
```

The deploy workflow builds the contracts image when needed, deploys the
program ID from `kicktick/target/deploy/kicktick-keypair.json`, and runs the
idempotent Config initialization using the repository-root `keypair.json`.

After a program ID change, keep these current for the scoped backend:

- `kicktick/programs/kicktick/src/lib.rs`;
- `kicktick/Anchor.toml`;
- `relayer/config/constants.json`;
- `KICKTICK_PROGRAM_ID` in the relayer environment, when overridden.

## 2. Run the Anchor test suite

```bash
./scripts/run.sh contracts
docker exec -it kicktick-contracts bash
npm test
```

The shared test setup starts a fresh local validator, deploys the program,
initializes Config, and exposes a provider to the test files. The current tests
cover user collateral, market lifecycle, voiding, complete-set settlement,
share trades, positions, and fill sequences.

For a devnet smoke test, use a separate scenario that connects to the deployed
program and creates unique fixture/market IDs. Do not run the localnet setup
against devnet: it resets a validator and deploys a fresh program.

## 3. Add a market type

1. Add the variant to `programs/kicktick/src/state/market.rs`.
2. Update `Market::outcome_count_for` and `Market::requires_oracle`.
3. Add or update oracle stat/predicate mapping in
   `programs/kicktick/src/instructions/settle_round.rs`.
4. Add the matching relayer definition and trigger behavior in
   `relayer/src/domain/markets.ts` and `relayer/src/market/triggers.ts`.
5. Add Anchor coverage in `kicktick/tests/market.ts` and settlement coverage
   where the new type changes CLOB behavior.

## 4. Add an instruction

1. Define the `#[derive(Accounts)]` context and handler in the appropriate
   `programs/kicktick/src/instructions/` module.
2. Re-export the module from `instructions/mod.rs`.
3. Wire the public instruction into `programs/kicktick/src/lib.rs`.
4. Update `program/INSTRUCTIONS.md`, the IDL-dependent relayer client, and
   tests in the same change.

## 5. Oracle settlement flow

For oracle-backed markets:

```text
TxLINE score sequence
  → relayer proof-gatherer
  → ValidateStatArgs
  → resolve_market_with_proof
  → TxOracle validate_stat CPI
  → Market ResolvedPending
  → confirm_market
```

`daily_scores_merkle_roots` is the TxOracle PDA
`["daily_scores_merkle_roots"]`. Proof sequence and market oracle parameters
must remain separate: `market_seq` identifies the market, while the TxLINE
sequence identifies the score record being proven.

## 6. CLOB settlement flow

```text
wallet-signed orders
  → relayer matching engine
  → durable fill record
  → settle_complete_set_binary/ternary or settle_share_trade
  → on-chain fill_sequence increment
```

The program does not expose a direct `place_bet` instruction. CLOB orders are
matched off-chain and the relayer applies validated fills on-chain.

## 7. Debug a transaction failure

```bash
solana confirm -v <TX_SIGNATURE> --url devnet
solana logs --url devnet
solana account <PDA> --output json --url devnet
```

For relayer issues, inspect `docker logs -f kicktick-relayer`, the durable
database under `relayer/data/`, and the saved SSE logs under `relayer/logs/`.
