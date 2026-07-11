---
id: relayer-triggers
type: reference
title: "Market Trigger Rules"
service: relayer
depends_on:
  - relayer-architecture
  - relayer-streams
related_to:
  - relayer-settlement
  - program-instructions
tags: [triggers, rules, markets, events, cron]
---

# Market Trigger Rules

## Overview

Rules engine in `src/market/triggers.ts`. Converts match events and time windows into `MarketCommand[]` consumed by the lifecycle executor.

### TriggerAction Types

```typescript
type MarketCommand =
  | { type: "open_market"; fixtureId; matchPda; marketSeq; marketType; deadlineSeconds }
  | { type: "lock_market"; fixtureId; matchPda; marketSeq; reason: "event" | "deadline" }
  | { type: "resolve_market_onchain"; fixtureId; matchPda; marketSeq; marketType; settlementSeq }
  | { type: "resolve_market_offchain"; fixtureId; matchPda; marketSeq; marketType; outcome: "Yes" | "No" }
  | { type: "confirm_market"; fixtureId; matchPda; marketSeq }
```

These commands are the canonical relayer domain vocabulary. The lifecycle
executor maps them to CLOB persistence, locking, proof/off-chain resolution,
and confirmation work.

### Market States

```
OPEN → LOCKED → RESOLVED_PENDING → RESOLVED
  │                  │
  ▼                  ▼
(VOIDED)       (confirmed after resolution)
```

---

## Market Type Timing

| Market Type | Deadline (s) | Lock trigger | Settlement |
|-------------|--------------|--------------|------------|
| NextGoalSide | 90 | goal event or deadline | On-chain |
| GoalInWindow | 300 | goal event or deadline | On-chain |
| NextCorner | 120 | corner event or deadline | On-chain |
| CornerInWindow | 180 | corner event or deadline | On-chain |
| NextYellowCard | 120 | card event or deadline | On-chain |
| YellowCardInWindow | 300 | card event or deadline | On-chain |
| RedCardInMatch | 7200 | red-card event or match end | On-chain |
| PenaltyShootoutShot | 30 | shot outcome or deadline | On-chain |
| PenaltyShot | 90 | penalty outcome or deadline | Off-chain |
| VARCheck | 120 | VAR end or deadline | Off-chain |

---

## Event-Triggered Rules

### Goal → NextGoalSide

```typescript
handleGoal(event, fixtureId, matchState, actions):
  // if NextGoalSide market open:
  //   lock immediately, then resolve (home=Yes, away=No)
  // open new NextGoalSide market after the event
```

### Corner → NextCorner

```typescript
handleCorner(event, fixtureId, matchState, actions):
  // if NextCorner market open → lock immediately, then resolve (home=Yes, away=No)
  // open new NextCorner market
```

### Yellow Card → NextYellowCard

```typescript
handleYellowCard(event, fixtureId, matchState, actions):
  // if NextYellowCard market open → lock immediately, then resolve (home=Yes, away=No)
  // open new NextYellowCard market
```

### Red Card → RedCardInMatch

```typescript
handleRedCard(event, fixtureId, matchState, actions):
  // if RedCardInMatch market open → lock immediately, then settle(Yes)
  // no new market opened (match-level binary market)
```

### Penalty Award → PenaltyShot

```typescript
handlePenalty(fixtureId, matchState, actions):
  // open new PenaltyShot market
```

### Penalty Outcome → PenaltyShot settle + optional shootout

```typescript
handlePenaltyOutcome(event, fixtureId, matchState, actions):
  if event.outcome === "Retake":
    // extend current PenaltyShot deadline +60s
    return
  // settle PenaltyShot (Scored=Yes, Missed=No)
  if penaltyShootoutMode:
    // settle current PenaltyShootoutShot
    // open new PenaltyShootoutShot
```

### VAR → VARCheck

```typescript
handleVar(event, fixtureId, matchState, actions):
  // open new VARCheck market
```

### VAR End → VARCheck settle

```typescript
handleVarEnd(event, fixtureId, matchState, actions):
  // settle VARCheck (Overturned=Yes, Stands=No)
```

---

## Cron Window Rules

Window markets fire on interval during live match time.

### Intervals

| Market Type | Interval |
|-------------|----------|
| GoalInWindow | 300s (5 min) |
| CornerInWindow | 180s (3 min) |
| YellowCardInWindow | 300s (5 min) |

### Logic

```typescript
checkCronWindows(fixtureId, matchState, actions):
  if matchClockMs <= 0 → return
  if match ended → return
  for each window market:
    if matchTime - lastOpened >= interval:
      open new market
      update lastOpened
```

Enabled via `startCronWindows(fixtureId)` after match init.

---

## Penalty Shootout Mode

Triggered when StatusId transitions to `PenaltyShootout` (12).

```typescript
handleStatus({ statusId: PenaltyShootout }, fixtureId, matchState, actions):
  f.penaltyShootoutMode = true
  open PenaltyShootoutShot #1
```

Each shootout shot follows:
```
penalty_outcome event
  → settle current PenaltyShootoutShot
  → open next PenaltyShootoutShot
  → f.penaltyShootoutRound++
```

Cleaned up on `FinishedAfterPenaltyShootout` (13).

---

## Timeout Handling

Polled every 5s via `setInterval` in `index.ts`.

```typescript
checkTimeouts(fixtureId):
  for each market:
    if market expired (now >= expiresAt):
      lock_market(reason="deadline")
      if market requires oracle proof:
        resolve_market_onchain(seq=last_proof_ready_sequence)
      else:
        resolve_market_offchain(No)
    if market is resolved pending and confirmation is allowed:
      confirm_market
```

---

## Match End Cleanup

On `FullTime`, `FinishedAfterExtraTime`, `FinishedAfterPenaltyShootout`:

1. Settle any open `RedCardInMatch` → No (no red card in remaining time)
2. Settle all remaining open markets → No (event didn't happen)
3. Stop cron windows

The settlement sequence is the upstream TxLINE score sequence, not the local market sequence. If TxLINE has not produced a proof for that sequence, the crank retries only the proof-not-ready case.
