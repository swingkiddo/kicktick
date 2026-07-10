---
id: relayer-architecture
type: architecture
title: "Relayer Architecture"
service: relayer
depends_on:
  - relayer-readme
related_to:
  - relayer-streams
  - relayer-triggers
  - relayer-settlement
  - relayer-api
  - integration-data-flow
tags: [architecture, data-flow, modules]
---

# Relayer Architecture

## Module Dependency Graph

```
index.ts (main loop)
  │
  ├── config.ts                 ── env/config bootstrap
  ├── clob/store.ts             ── SQLite markets, orders, fills, nonces
  ├── clob/matching-engine.ts   ── price-time matching
  ├── clob/settlement.ts        ── serialized fill submission + recovery
  ├── clob/lifecycle.ts         ── open / freeze / lock / resolve / confirm
  ├── clob/ws-api.ts            ── wallet-authenticated WebSocket API
  │
  ├── txline-client.ts          ── SSE stream (scores + odds)
  │     │
  │     ├── event-parser.ts     ── raw SSE → typed FootballEvent
  │     │     │
  │     │     ├── fixture-watcher.ts  ── match state tracking
  │     │     │     │
  │     │     │     └── market-trigger/triggers.ts  ── market rules engine
  │     │     │           │
  │     │     │           ├── proof-gatherer.ts     ── Merkle proof fetch
  │     │     │           │     │
  │     │     │           │     └── crank.ts        ── tx builder + sender
  │     │     │           │           │
  │     │     │           │           └── anchor-client.ts ── Solana RPC
  │     │     │           │
  │     │     │           └── ws-server.ts         ── push to frontend
  │     │     │
  │     │     └── (events also flow to ws-server for broadcast)
```

## Startup Sequence

```
1. loadConfig()                      env → Config struct
2. new WsServer(port).start()        WebSocket listener up
3. new TxLineClient(config)          SSE client init
4. new AnchorClient(config)          Solana wallet + IDL load
5. new ProofGatherer(client)         proof fetcher
6. new Crank(anchor, proof)          crank executor
7. new FixtureWatcher(client, cfg)   match state manager
8. new MarketTrigger()               rules engine
9. authenticate()                    TxLINE JWT
10. getFixtures(72)                  World Cup fixtures
11. loadFixture(id) for top 5       match state init
12. startCronWindows(id)             window markets on
13. streamScores() SSE loop          main event loop
14. setInterval(checkTimeouts, 5s)   timeout checker
```

## Event Processing Pipeline

```
TxLINE SSE (raw string)
  │
  ▼
event-parser.parseFootballEvent()
  ├── JSON.parse(data)
  ├── switch(Action)
  │     goal → GoalEvent { participant, goalType }
  │     corner → CornerEvent
  │     yellow_card → YellowCardEvent
  │     red_card → RedCardEvent
  │     penalty → PenaltyAwardedEvent
  │     penalty_outcome → PenaltyOutcomeEvent
  │     var → VarCheckEvent
  │     var_end → VarEndEvent
  │     status → StatusChangeEvent
  │     ... (18 action types total)
  └── return FootballEvent (union type)
  │
  ▼
fixture-watcher.processEvent(event, fixtureId)
  ├── status → handleStatusChange (match_start, match_half, match_pe, match_end)
  ├── goal → handleGoal (homeScore++ / awayScore++)
  ├── score_adjustment → handleScoreAdjustment
  └── emit FixtureWatcherEvents
  │
  ▼
market-trigger.processEvent(event, fixtureId, matchState)
    ├── goal → settle NextGoalSide + open new
    ├── corner → settle NextCorner + open new
    ├── yellow_card → settle NextYellowCard + open new
    ├── red_card → settle RedCardInMatch
    ├── penalty → open PenaltyShot
    ├── penalty_outcome → settle PenaltyShot + shootout
    ├── var → open VARCheck
    ├── var_end → settle VARCheck
    ├── status (FirstHalf) → open NextGoalSide + RedCardInMatch
    ├── status (PenaltyShootout) → enter shootout mode
    ├── status (FT/FET/FPE) → match end cleanup
    └── emit TriggerAction[]
      │
  ├─► proof-gatherer.gatherProof(fixtureId, seq, statKey, period)
  │     └── GET /stat-validation → StatValidationResult
  │
  └─► executeTriggerActions(actions)
        ├── open_round → CLOB market init + lifecycle.open()
        ├── settle_onchain → proof settlement queue + resolve_market_with_proof()
        ├── settle_offchain → resolve_market_offchain()
        └── confirm_round → confirm_market() / lifecycle state advance
  │
  ▼
ws-server.broadcastToMatch(fixtureId, msg)
  └── push to subscribed WebSocket clients
```

## Connection Lifecycle

```
TxLINE SSE
  │
  connect ───► authenticated ───► streaming ───► disconnect
                  │                    │              │
                  ▼                    ▼              ▼
            heartbeat(30s)      exponential     reconnect
            keepalive           backoff         after delay
                                (1s–30s)        (infinite)
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| EventEmitter-based | Node.js native pattern, multiple consumers per event |
| Durable state | SQLite persists CLOB markets, signed orders, fills, and nonce uniqueness; Solana remains authoritative for collateral and positions. |
| Sequential action execution | Avoid nonce conflicts, simplify retry |
| Exponential backoff | Don't hammer TxLINE on reconnect |
| 5s timeout poll | Balance responsiveness vs CPU |
| Top 5 fixtures only | Devnet cost + demo focus |
