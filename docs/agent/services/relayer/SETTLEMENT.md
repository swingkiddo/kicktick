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

This document covers the transition from trading to market resolution. A market
is kept open while its outcome is uncertain. When an SSE event makes the
outcome determinable, the relayer stops accepting new CLOB intake, drains
already matched fills, locks the market, and only then resolves it. The same
lock-and-resolve sequence runs at the deadline when no determining event was
observed.

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
  ├── anchor-client.settleCompleteSetFill(fill, orders sorted by outcome)
  │     └── complete-set fills settle exactly two binary outcomes
  └── confirmFill / markFillSubmitted
```

When a relayer restarts, it reloads `MATCHED` and `SUBMITTED` fills from SQLite, compares them to on-chain `fillSequence`, and either confirms the fill or retries the queue.

Complete-set orders are expanded from SQLite into full `StoredOrder` records,
sorted by `outcome_index`, and submitted as YES then NO. Ternary CLOB orders are
rejected before matching. BUY reserve views use the same ceil calculation as
the program, and the manual Order PDA decoder expects the current 118-byte
layout with `nonce` at byte offset 100.

### Fill state machine

```text
MATCHED → SUBMITTED → CONFIRMED
   │          │
   │          └── UNKNOWN (signature/transport result is ambiguous)
   └───────────── FAILED_RETRYABLE / FAILED_FINAL
```

`UNKNOWN` must keep the reservation. It is not safe to release or resubmit until signature status and the on-chain market `fillSequence` have been checked.

## 2) Market resolution

```
market-trigger emits lock_market(reason) and a resolve command
  │
  ▼
crank.executeTriggerActions([...])
  │
  ├── stop new CLOB intake and drain matched fills
  ├── anchor-client.lockMarket()
  │     └── Solana tx: lock_market → Locked
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
| PenaltyShot | Scored | outcome 0 | 0 |
| PenaltyShot | Missed | outcome 1 | 1 |
| VARCheck | Overturned | outcome 0 | 0 |
| VARCheck | Stands | outcome 1 | 1 |

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

Two independent retry loops protect a `resolve_market_onchain` action:

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
  marketSeq: number;
  action: string;     // legacy trigger alias for market lifecycle actions
  status: "pending" | "sent" | "confirmed" | "failed";
  txSig?: string;
  error?: string;
  timestamp: number;
}
```

Emitted via `EventEmitter`, consumed by:
- `ws-server.ts` → push to frontend
- `app/relayer-runtime.ts` → logging + WS broadcast

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

Timeout handler checks every 5s for markets in `ResolvedPending` state and
confirms them when the current market policy allows it. The current on-chain
Config has `finality_delay = 0`, so confirmation is immediate after resolution.

### Error Recovery

| Error | Handling |
|-------|----------|
| Transaction failure | Retry up to 3x with backoff |
| Anchor error log | Parse for anchor error code, surface in status |
| Proof record not merklized yet | Retry only `ProofNotReadyError` with bounded backoff |
| Other proof/auth/network error | Fail fast and preserve the durable lifecycle action for diagnosis/recovery |

## Current limitations

- The relayer does not yet reject every order using on-chain `UserAccount` balance and `Position` state before local matching.
- Error-text classification is not a substitute for Solana signature reconciliation.
- A timeout action must carry a proof-ready upstream sequence; a missing sequence must be treated as a blocked action, not settled with an arbitrary proof.
