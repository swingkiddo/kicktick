// SSE loop source of truth: relayer/src/index.ts:190-213
import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_KICKTICK_PROGRAM_ID } from "../../src/config";
import { MarketTrigger, TriggerAction } from "../../src/market/triggers";
import { parseSoccerEvent } from "../../src/market/event-parser";
import { TxLineSseEvent } from "../../src/clients/txline-client";
import { FixtureWatcher, MatchState } from "../../src/market/fixture-watcher";
import { StatusId, MarketType } from "../../src/market/event-parser";
import fixtures from "../fixtures/match-lifecycle.json";

const PROGRAM_ID = DEFAULT_KICKTICK_PROGRAM_ID;

function makeMatchState(fixtureId: number, overrides?: Partial<MatchState>): MatchState {
  return {
    fixtureId,
    matchPda: PublicKey.findProgramAddressSync(
      [Buffer.from("match"), Buffer.alloc(8)],
      PROGRAM_ID,
    )[0],
    matchPdaBump: 255,
    status: StatusId.FirstHalf,
    currentPeriod: "H1",
    homeScore: 0,
    awayScore: 0,
    matchClockMs: 600_000,
    lastEventAt: Date.now(),
    marketCounter: 0,
    participants: { home: "Team A", away: "Team B" },
    ...overrides,
  };
}

function makeSseEvent(raw: object): TxLineSseEvent {
  return { data: JSON.stringify(raw) };
}

function seedFixtureWatcher(watcher: FixtureWatcher, fixtureId: number, matchState?: Partial<MatchState>): void {
  // TODO: accessing private field — refactor when FixtureWatcher exposes seeding API
  (watcher as any).matches.set(fixtureId, makeMatchState(fixtureId, matchState));
}

function captureActions(trigger: MarketTrigger): () => TriggerAction[][] {
  const captured: TriggerAction[][] = [];
  trigger.on("actions", (actions: TriggerAction[]) => captured.push(actions));
  return () => captured;
}

function runSseLoop(events: TxLineSseEvent[], trigger: MarketTrigger, watcher: FixtureWatcher): TriggerAction[] {
  const allActions: TriggerAction[] = [];
  trigger.on("actions", (actions: TriggerAction[]) => allActions.push(...actions));

  for (const event of events) {
    if (event.event === "heartbeat") continue;
    const rawData = JSON.parse(event.data);
    if (Object.keys(rawData).length === 1 && "Ts" in rawData) continue;
    const fixtureId = rawData.fixtureId;
    if (!fixtureId) continue;
    if (typeof rawData.competitionId === "number" && rawData.competitionId !== 72) continue;

    const soccerEvent = parseSoccerEvent(event);
    if (!soccerEvent) continue;

    const matchState = watcher.processEvent(soccerEvent, fixtureId);
    if (matchState) {
      trigger.processEvent(soccerEvent, fixtureId, matchState);
    }
  }
  return allActions;
}

function advanceClockAndCheckTimeouts(trigger: MarketTrigger, fixtureId: number): TriggerAction[] {
  const fixtureState = (trigger as any).fixtures.get(fixtureId);
  if (!fixtureState) return [];
  for (const market of fixtureState.markets.values()) {
    if (market.status === "open") {
      market.expiresAt = 0; // force expiry (checkTimeouts uses Date.now())
    }
  }
  return trigger.checkTimeouts(fixtureId);
}

describe("SSE Simulation Harness", () => {
  const FIXTURE_ID = 9001;

  function loadEvents(key: keyof typeof fixtures): TxLineSseEvent[] {
    return (fixtures as any)[key].map((str: string) => makeSseEvent(JSON.parse(str)));
  }

  describe("Scenario 1: fullMatch", () => {
    it("replays status→goal→yellow→corner→FullTime and produces correct action stream", () => {
      const watcher = new FixtureWatcher(null as any, { kicktickProgramId: PROGRAM_ID } as any);
      const trigger = new MarketTrigger();
      seedFixtureWatcher(watcher, FIXTURE_ID);

      const events = loadEvents("fullMatch");
      const actions = runSseLoop(events, trigger, watcher);

      const openMarkets = actions.filter((a) => a.type === "open_market");
      const settleOffchain = actions.filter((a) => a.type === "resolve_market_offchain");
      const settleOnchain = actions.filter((a) => a.type === "resolve_market_onchain");

      // 5 open markets: NextGoalSide(FirstHalf), RedCardInMatch(FirstHalf), NextGoalSide(after goal), NextYellowCard, NextCorner
      expect(openMarkets).to.have.length(5);

      const nextGoalSideOpens = openMarkets.filter((a) => (a as any).marketType === MarketType.NextGoalSide);
      expect(nextGoalSideOpens).to.have.length(2);

      const redCardOpens = openMarkets.filter((a) => (a as any).marketType === MarketType.RedCardInMatch);
      expect(redCardOpens).to.have.length(1);

      const nextYellowOpens = openMarkets.filter((a) => (a as any).marketType === MarketType.NextYellowCard);
      expect(nextYellowOpens).to.have.length(1);

      const nextCornerOpens = openMarkets.filter((a) => (a as any).marketType === MarketType.NextCorner);
      expect(nextCornerOpens).to.have.length(1);

      // resolve_market_onchain: NextGoalSide from goal, RedCardInMatch, plus ternary markets at FullTime
      expect(settleOnchain).to.have.length(5);

      const goalSettle = settleOnchain.find(
        (a) => (a as any).marketType === MarketType.NextGoalSide && (a as any).targetStatKey,
      );
      expect(goalSettle).to.exist;
      expect((goalSettle as any).targetStatKey).to.equal(1);

      const redCardSettle = settleOnchain.find(
        (a) => (a as any).marketType === MarketType.RedCardInMatch,
      );
      expect(redCardSettle).to.exist;
      expect((redCardSettle as any).settlementSeq).to.equal(104);

      // resolve_market_offchain: no off-chain cleanups (ternary now on-chain)
      expect(settleOffchain).to.have.length(0);

      // lastSeenSeq should be 104 (FullTime event seq)
      expect((trigger as any).lastSeenSeq.get(FIXTURE_ID)).to.equal(104);
    });
  });

  describe("Scenario 2: goalTimeout", () => {
    it("settles open NextGoalSide as NoGoal when it times out", () => {
      const watcher = new FixtureWatcher(null as any, { kicktickProgramId: PROGRAM_ID } as any);
      const trigger = new MarketTrigger();
      seedFixtureWatcher(watcher, FIXTURE_ID);

      const events = loadEvents("goalTimeout");
      const actions = runSseLoop(events, trigger, watcher);

      // After FirstHalf + goal: 3 open_markets and 1 resolve_market_offchain
      const openMarkets = actions.filter((a) => a.type === "open_market");
      expect(openMarkets).to.have.length(3);

      // active NextGoalSide market exists before timeout
      const activeBefore = trigger.getActiveMarkets(FIXTURE_ID);
      expect(activeBefore.some((r) => r.marketType === MarketType.NextGoalSide)).to.be.true;

      // Force timeout on all open markets
      const timeoutActions = advanceClockAndCheckTimeouts(trigger, FIXTURE_ID);

      const noGoalSettle = timeoutActions.find(
        (a) =>
          a.type === "resolve_market_onchain" &&
          (a as any).marketType === MarketType.NextGoalSide,
      );
      expect(noGoalSettle).to.exist;
    });
  });

  describe("Scenario 3: cronWindows", () => {
    it("opens GoalInWindow only when 300s interval elapsed", () => {
      const watcher = new FixtureWatcher(null as any, { kicktickProgramId: PROGRAM_ID } as any);
      const trigger = new MarketTrigger();
      seedFixtureWatcher(watcher, FIXTURE_ID, { matchClockMs: 0 });

      trigger.startCronWindows(FIXTURE_ID);

      const events = loadEvents("cronWindows");
      const clocks = [300_000, 599_000, 600_000];

      const stepCapture = captureActions(trigger);
      let prevBatchCount = 0;

      for (let i = 0; i < events.length; i++) {
        const state = watcher.getFixtureState(FIXTURE_ID)!;
        state.matchClockMs = clocks[i];

        const soccerEvent = parseSoccerEvent(events[i]);
        const matchState = watcher.processEvent(soccerEvent, FIXTURE_ID)!;
        trigger.processEvent(soccerEvent, FIXTURE_ID, matchState);

        const batches = stepCapture();
        const stepActions = batches.length > prevBatchCount ? batches[batches.length - 1] : [];
        prevBatchCount = batches.length;

        const newOpens = stepActions.filter(
          (a) => a.type === "open_market" && (a as any).marketType === MarketType.GoalInWindow,
        );

        if (i === 0) expect(newOpens).to.have.length(1, "after 300s");
        if (i === 1) expect(newOpens).to.have.length(0, "after 599s");
        if (i === 2) expect(newOpens).to.have.length(1, "after 600s");
      }
    });
  });

  describe("Scenario 4: penaltyShootout", () => {
    it("opens, settles onchain with seq, and re-opens PenaltyShootoutShot markets", () => {
      const watcher = new FixtureWatcher(null as any, { kicktickProgramId: PROGRAM_ID } as any);
      const trigger = new MarketTrigger();
      seedFixtureWatcher(watcher, FIXTURE_ID);

      const events = loadEvents("penaltyShootout");
      const actions = runSseLoop(events, trigger, watcher);

      const openMarkets = actions.filter(
        (a) => a.type === "open_market" && (a as any).marketType === MarketType.PenaltyShootoutShot,
      );
      expect(openMarkets).to.have.length(2);

      const settleOnchain = actions.find(
        (a) =>
          a.type === "resolve_market_onchain" &&
          (a as any).marketType === MarketType.PenaltyShootoutShot &&
          (a as any).settlementSeq === 42,
      );
      expect(settleOnchain).to.exist;
    });
  });

  describe("Scenario 5: mixedCleanup", () => {
    it("settles OnChain markets onchain and OffChain markets as No at FullTime", () => {
      const watcher = new FixtureWatcher(null as any, { kicktickProgramId: PROGRAM_ID } as any);
      const trigger = new MarketTrigger();
      seedFixtureWatcher(watcher, FIXTURE_ID);

      const events = loadEvents("mixedCleanup");
      const actions = runSseLoop(events, trigger, watcher);

      const openMarkets = actions.filter((a) => a.type === "open_market");
      expect(openMarkets).to.have.length(3); // NextGoalSide, RedCardInMatch, VARCheck

      const settleOnchain = actions.filter((a) => a.type === "resolve_market_onchain");
      expect(settleOnchain).to.have.length(2);
      const onchainMarkets = settleOnchain.map((a) => (a as any).marketType);
      expect(onchainMarkets).to.include(MarketType.NextGoalSide);
      expect(onchainMarkets).to.include(MarketType.RedCardInMatch);
      const redCardSettle = settleOnchain.find((a) => (a as any).marketType === MarketType.RedCardInMatch);
      expect((redCardSettle as any).settlementSeq).to.equal(502);

      const settleOffchain = actions.filter((a) => a.type === "resolve_market_offchain");
      expect(settleOffchain).to.have.length(1);
      const offchainMarkets = settleOffchain.map((a) => (a as any).marketType);
      expect(offchainMarkets).to.include(MarketType.VARCheck);

      const varCheckSettle = settleOffchain.find((a) => (a as any).marketType === MarketType.VARCheck);
      expect(varCheckSettle).to.exist;
      expect((varCheckSettle as any).outcome).to.equal("No");

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      expect(active).to.have.length(0);
    });
  });
});
