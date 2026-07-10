---
id: relayer-settlement
type: reference
title: "Proof Gathering & Settlement Crank"
service: relayer
depends_on:
  - relayer-architecture
  - relayer-triggers
related_to:
  - program-instructions
  - integration-data-flow
tags: [settlement, proof, crank, CPI, transaction]
---

# Proof Gathering & Settlement Crank

This document covers market resolution after trading has already happened. The trade path itself is described in `CLOB.md` and uses the fill queue in `src/clob/settlement.ts`.

## 1) CLOB fill settlement

```
matching-engine emits MATCHED fill
  │
  ▼
FillSettlementQueue.submit(fill)
  │
  ├── serialize per market
  ├── anchor-client.settleClobFill(fill)
  │     └── direct fills settle buyer/seller positions
  ├── anchor-client.settleCompleteSetFill(fill, owners)
  │     └── complete-set fills settle 2-way or 3-way outcomes
  └── confirmFill / markFillSubmitted
```

When a relayer restarts, it reloads `MATCHED` and `SUBMITTED` fills from SQLite, compares them to on-chain `fillSequence`, and either confirms the fill or retries the queue.

## 2) Market resolution

```
market-trigger emits settle_onchain or settle_offchain
  │
  ▼
crank.executeTriggerActions([...])
  │
  ├── proof-gatherer.getStatKeysForMarket(marketType)
  │     returns the stat key(s) needed for the market
  │
  ├── proof-gatherer.gatherProof(fixtureId, seq, statKey, period)
  │     └── txline-client.getStatValidation(fixtureId, seq, statKey)
  │           └── GET /stat-validation → StatValidationResult
  │
  ├── assemble proof args and predicate
  │
  ├── anchor-client.resolveMarketWithProof(args)
  │     └── Solana tx: resolve_market_with_proof
  │           ├── CPI: txoracle::validate_stat
  │           └── CU limit: 1,400,000
  │
  └── anchor-client.resolveMarketOffchain(winner)
        └── Solana tx: resolve_market_offchain
```

### Binary markets

`GoalInWindow`, `CornerInWindow`, `YellowCardInWindow`, and `RedCardInMatch` resolve from one proof path and a threshold check (`value > 0`).

### Ternary markets

`NextGoalSide`, `NextCorner`, `NextYellowCard`, and `PenaltyShootoutShot` resolve from two participant proof paths.
The relayer combines the two paths with `op: Add` so `statA + statB > 0` determines the winner.

### Off-chain outcomes

| Market | Event | Outcome | Winner |
|--------|-------|---------|--------|
| PenaltyShot | Scored | Yes | 1 |
| PenaltyShot | Missed | No | 2 |
| VARCheck | Overturned | Yes | 1 |
| VARCheck | Stands | No | 2 |

## Proof Data Structure

```typescript
interface SettleProofArgs {
  ts: number;
  fixtureSummary: {
    fixtureId: number;
    updateStats: { updateCount; minTimestamp; maxTimestamp };
    eventsSubTreeRoot: number[];
  };
  fixtureProof: ProofNode[];
  mainTreeProof: ProofNode[];
  predicate: { threshold: number; comparison: "GreaterThan" };
  statA: StatTermData;
  statB?: StatTermData;  // ternary markets
  op?: "Add";            // ternary markets
}
```

### StatKey Mapping

| Market Type | statKey(s) | Period |
|-------------|------------|--------|
| NextGoalSide | 1 (home goals), 2 (away goals) | H1 (0) |
| GoalInWindow | 1 (home goals) | H1 (0) |
| NextCorner | 7 (home corners), 8 (away corners) | H1 (0) |
| CornerInWindow | 7 (home corners) | H1 (0) |
| NextYellowCard | 3 (home YC), 4 (away YC) | H1 (0) |
| YellowCardInWindow | 3 (home YC) | H1 (0) |
| RedCardInMatch | 5 (home RC) | H1 (0) |
| PenaltyShootoutShot | 5001 (home PE goals), 5002 (away PE goals) | PE (5000) |

---

## Crank Executor

Implemented in `src/settlement/crank.ts`.

### Retry Policy

Two independent retry loops protect a `settle_onchain` action:

**Anchor transaction retry** (`executeWithRetry` in `crank.ts`):
```typescript
maxRetries = 3
retryDelayMs = 1000 (×2 per attempt)

attempt 0 → 1000ms
attempt 1 → 2000ms
attempt 2 → 4000ms
```

**Proof-gather retry** (`gatherProofWithRetry` in `crank.ts`) — only on `ProofNotReadyError`:
```typescript
proofMaxAttempts = 4
proofBackoffMs = [0, 1000, 2000, 4000]   // 0/1/2/4s → ≤8s total

attempt 0 → 0ms
attempt 1 → 1000ms
attempt 2 → 2000ms
attempt 3 → 4000ms
```

Triggered when `/scores/stat-validation` returns 404 with body matching
"processed scores record" / "could not be found" — race between SSE event
arrival and TxODDS merklization. Non-404 errors (auth, network, 5xx) fail fast
to surface real bugs.

Tunable via `CrankOptions`:
```typescript
new Crank(anchorClient, proofGatherer, {
  proofMaxAttempts: 6,
  proofBackoffMs: [0, 1000, 2000, 4000, 8000, 16000],
});
```

### Action Execution

Sequential (one by one) to avoid nonce conflicts:

```
for each action:
  await executeAction(action)
```

### CrankStatus Events

```typescript
interface CrankStatus {
  fixtureId: number;
  roundId: number;
  action: string;     // legacy trigger alias for market lifecycle actions
  status: "pending" | "sent" | "confirmed" | "failed";
  txSig?: string;
  error?: string;
  timestamp: number;
}
```

Emitted via `EventEmitter`, consumed by:
- `ws-server.ts` → push to frontend
- `index.ts` → logging + WS broadcast

---

## Solana Transaction Building

### CU Budget

All market-resolution transactions use `ComputeBudgetProgram.setComputeUnitLimit(1_400_000)`.

### Finality

```
resolve_market_with_proof / resolve_market_offchain → ResolvedPending
  ↓ (immediate)
confirm_market → Resolved
```

Timeout handler checks every 5s for markets in `ResolvedPending` state with elapsed >= 60s.

### Error Recovery

| Error | Handling |
|-------|----------|
| Transaction failure | Retry up to 3x with backoff |
| Anchor error log | Parse for anchor error code, surface in status |
| Missing proof data | Failure logged, no retry (proof is deterministic for seq) |
