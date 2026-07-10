import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_KICKTICK_PROGRAM_ID } from "../../src/config";
import { MarketTrigger, TriggerAction, MARKET_TIMINGS } from "../../src/market/triggers";
import {
  SoccerAction,
  StatusId,
  MarketType,
  GoalType,
  VarType,
  GoalEvent,
  CornerEvent,
  YellowCardEvent,
  RedCardEvent,
  PenaltyOutcomeEvent,
  VarCheckEvent,
  VarEndEvent,
  StatusChangeEvent,
  SoccerEvent,
} from "../../src/market/event-parser";
import type { MatchState } from "../../src/market/fixture-watcher";

const PROGRAM_ID = DEFAULT_KICKTICK_PROGRAM_ID;
const FIXTURE_ID = 1001;

function makeMatchState(overrides?: Partial<MatchState>): MatchState {
  return {
    fixtureId: FIXTURE_ID,
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

describe("MarketTrigger", () => {
  let trigger: MarketTrigger;
  let state: MatchState;
  let emittedActions: TriggerAction[][];

  beforeEach(() => {
    trigger = new MarketTrigger();
    state = makeMatchState();
    emittedActions = [];
    trigger.on("actions", (actions: TriggerAction[]) => {
      emittedActions.push(actions);
    });
  });

  function flatActions(): TriggerAction[] {
    return emittedActions.flat();
  }

  // ── 1. Event → TriggerAction mapping ──

  describe("Event → TriggerAction mapping", () => {
    describe("Goal event", () => {
      it("settles existing open market and opens new NextGoalSide", () => {
        const goal1: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
        trigger.processEvent(goal1, FIXTURE_ID, state);

        const first = flatActions();
        expect(first).to.have.length(1);
        expect(first[0].type).to.equal("open_market");
        expect((first[0] as any).marketType).to.equal(MarketType.NextGoalSide);

        const goal2: GoalEvent = { action: SoccerAction.Goal, participant: 2, goalType: GoalType.Head };
        trigger.processEvent(goal2, FIXTURE_ID, state);

        const all = flatActions();
        const settle = all.find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.NextGoalSide);
        expect(settle).to.exist;
        expect((settle as any).targetStatKey).to.equal(2);

        const opens = all.filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.NextGoalSide);
        expect(opens).to.have.length(2);
      });

      it("settles with Home when participant is 1", () => {
        const goal1: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
        trigger.processEvent(goal1, FIXTURE_ID, state);
        emittedActions = [];

        const goal2: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
        trigger.processEvent(goal2, FIXTURE_ID, state);

        const settle = flatActions().find((a) => a.type === "resolve_market_onchain");
        expect(settle).to.exist;
        expect((settle as any).targetStatKey).to.equal(1);
      });
    });

    describe("Corner event", () => {
      it("settles existing market and opens new NextCorner", () => {
        const corner1: CornerEvent = { action: SoccerAction.Corner, participant: 1 };
        trigger.processEvent(corner1, FIXTURE_ID, state);

        const corner2: CornerEvent = { action: SoccerAction.Corner, participant: 2 };
        trigger.processEvent(corner2, FIXTURE_ID, state);

        const all = flatActions();
        const settle = all.find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.NextCorner);
        expect(settle).to.exist;
        expect((settle as any).targetStatKey).to.equal(8);

        const opens = all.filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.NextCorner);
        expect(opens).to.have.length(2);
      });
    });

    describe("YellowCard event", () => {
      it("settles existing market and opens new NextYellowCard", () => {
        const yc1: YellowCardEvent = { action: SoccerAction.YellowCard, participant: 1 };
        trigger.processEvent(yc1, FIXTURE_ID, state);

        const yc2: YellowCardEvent = { action: SoccerAction.YellowCard, participant: 2 };
        trigger.processEvent(yc2, FIXTURE_ID, state);

        const all = flatActions();
        const settle = all.find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.NextYellowCard);
        expect(settle).to.exist;
        expect((settle as any).targetStatKey).to.equal(4);

        const opens = all.filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.NextYellowCard);
        expect(opens).to.have.length(2);
      });
    });

    describe("RedCard event", () => {
      it("settles RedCardInMatch as Yes when open market exists", () => {
        const statusEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.FirstHalf };
        trigger.processEvent(statusEvt, FIXTURE_ID, state);
        emittedActions = [];

        const redCard: RedCardEvent = {
          action: SoccerAction.RedCard,
          participant: 1,
          redCardType: "StraightRed",
        };
        trigger.processEvent(redCard, FIXTURE_ID, state);

        const settle = flatActions().find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.RedCardInMatch);
        expect(settle).to.exist;
        expect((settle as any).targetStatKey).to.equal(5);
      });

      it("does nothing when no open RedCardInMatch market", () => {
        const redCard: RedCardEvent = {
          action: SoccerAction.RedCard,
          participant: 1,
          redCardType: "StraightRed",
        };
        trigger.processEvent(redCard, FIXTURE_ID, state);

        expect(flatActions()).to.have.length(0);
      });
    });

    describe("Penalty event", () => {
      it("opens PenaltyShot market", () => {
        const penalty: SoccerEvent = { action: SoccerAction.Penalty, participant: 1 } as any;
        trigger.processEvent(penalty, FIXTURE_ID, state);

        const open = flatActions().find((a) => a.type === "open_market" && (a as any).marketType === MarketType.PenaltyShot);
        expect(open).to.exist;
      });
    });

    describe("PenaltyOutcome event", () => {
      it("settles PenaltyShot as Yes on Scored", () => {
        const penalty: SoccerEvent = { action: SoccerAction.Penalty, participant: 1 } as any;
        trigger.processEvent(penalty, FIXTURE_ID, state);
        emittedActions = [];

        const outcome: PenaltyOutcomeEvent = {
          action: SoccerAction.PenaltyOutcome,
          participant: 1,
          outcome: "Scored",
        };
        trigger.processEvent(outcome, FIXTURE_ID, state);

        const settle = flatActions().find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.PenaltyShot);
        expect(settle).to.exist;
        expect((settle as any).targetStatKey).to.equal(159);
      });

      it("settles PenaltyShot as No on Missed", () => {
        const penalty: SoccerEvent = { action: SoccerAction.Penalty, participant: 1 } as any;
        trigger.processEvent(penalty, FIXTURE_ID, state);
        emittedActions = [];

        const outcome: PenaltyOutcomeEvent = {
          action: SoccerAction.PenaltyOutcome,
          participant: 1,
          outcome: "Missed",
        };
        trigger.processEvent(outcome, FIXTURE_ID, state);

        const settle = flatActions().find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.PenaltyShot);
        expect(settle).to.exist;
        expect((settle as any).targetStatKey).to.equal(159);
      });

      it("extends deadline by 60s on Retake, no settlement", () => {
        const penalty: SoccerEvent = { action: SoccerAction.Penalty, participant: 1 } as any;
        trigger.processEvent(penalty, FIXTURE_ID, state);

        const active = trigger.getActiveMarkets(FIXTURE_ID);
        const penMarket = active.find((r) => r.marketType === MarketType.PenaltyShot);
        expect(penMarket).to.exist;
        const originalExpiresAt = penMarket!.expiresAt;

        emittedActions = [];

        const retake: PenaltyOutcomeEvent = {
          action: SoccerAction.PenaltyOutcome,
          participant: 1,
          outcome: "Retake",
        };
        trigger.processEvent(retake, FIXTURE_ID, state);

        expect(flatActions()).to.have.length(0);

        const after = trigger.getActiveMarkets(FIXTURE_ID);
        const updated = after.find((r) => r.marketType === MarketType.PenaltyShot);
        expect(updated).to.exist;
        expect(updated!.expiresAt).to.equal(originalExpiresAt + 60_000);
      });
    });

    describe("Var event", () => {
      it("opens VARCheck market", () => {
        const varEvt: VarCheckEvent = {
          action: SoccerAction.Var,
          participant: 1,
          varType: VarType.Goal,
        };
        trigger.processEvent(varEvt, FIXTURE_ID, state);

        const open = flatActions().find((a) => a.type === "open_market" && (a as any).marketType === MarketType.VARCheck);
        expect(open).to.exist;
      });
    });

    describe("VarEnd event", () => {
      it("settles VARCheck as Yes on Overturned", () => {
        const varEvt: VarCheckEvent = { action: SoccerAction.Var, varType: VarType.Goal };
        trigger.processEvent(varEvt, FIXTURE_ID, state);
        emittedActions = [];

        const varEnd: VarEndEvent = { action: SoccerAction.VarEnd, outcome: "Overturned" };
        trigger.processEvent(varEnd, FIXTURE_ID, state);

        const settle = flatActions().find((a) => a.type === "resolve_market_offchain" && (a as any).marketType === MarketType.VARCheck);
        expect(settle).to.exist;
        expect((settle as any).outcome).to.equal("Yes");
      });

      it("settles VARCheck as No on Stands", () => {
        const varEvt: VarCheckEvent = { action: SoccerAction.Var, varType: VarType.Goal };
        trigger.processEvent(varEvt, FIXTURE_ID, state);
        emittedActions = [];

        const varEnd: VarEndEvent = { action: SoccerAction.VarEnd, outcome: "Stands" };
        trigger.processEvent(varEnd, FIXTURE_ID, state);

        const settle = flatActions().find((a) => a.type === "resolve_market_offchain" && (a as any).marketType === MarketType.VARCheck);
        expect(settle).to.exist;
        expect((settle as any).outcome).to.equal("No");
      });
    });
  });

  // ── 2. Status transitions ──

  describe("Status transitions", () => {
    it("FirstHalf opens NextGoalSide and RedCardInMatch", () => {
      const evt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.FirstHalf };
      trigger.processEvent(evt, FIXTURE_ID, state);

      const opens = flatActions().filter((a) => a.type === "open_market");
      const types = opens.map((a) => (a as any).marketType);
      expect(types).to.include(MarketType.NextGoalSide);
      expect(types).to.include(MarketType.RedCardInMatch);
    });

    it("PenaltyShootout enables penalty shootout mode and opens PenaltyShootoutShot", () => {
      const evt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.PenaltyShootout };
      trigger.processEvent(evt, FIXTURE_ID, state);

      const opens = flatActions().filter((a) => a.type === "open_market");
      expect(opens).to.have.length(1);
      expect((opens[0] as any).marketType).to.equal(MarketType.PenaltyShootoutShot);
    });

    it("FullTime settles OnChain markets on-chain and OffChain markets off-chain", () => {
      const startEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.FirstHalf };
      trigger.processEvent(startEvt, FIXTURE_ID, state);
      emittedActions = [];

      const varEvt: VarCheckEvent = { action: SoccerAction.Var, varType: VarType.Goal };
      trigger.processEvent(varEvt, FIXTURE_ID, state);
      emittedActions = [];

      const endEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.FullTime };
      trigger.processEvent(endEvt, FIXTURE_ID, state);

      const onchainSettles = flatActions().filter((a) => a.type === "resolve_market_onchain");
      expect(onchainSettles.length).to.be.greaterThan(0);
      for (const s of onchainSettles) {
        expect((s as any).settlementSeq).to.equal(0);
      }

      const offchainSettles = flatActions().filter((a) => a.type === "resolve_market_offchain");
      expect(offchainSettles.length).to.be.greaterThan(0);
      for (const s of offchainSettles) {
        expect((s as any).outcome).to.equal("No");
      }

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      expect(active).to.have.length(0);
    });

    it("FinishedAfterExtraTime settles all open markets as No", () => {
      const startEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.FirstHalf };
      trigger.processEvent(startEvt, FIXTURE_ID, state);
      emittedActions = [];

      const varEvt: VarCheckEvent = { action: SoccerAction.Var, varType: VarType.Goal };
      trigger.processEvent(varEvt, FIXTURE_ID, state);
      emittedActions = [];

      const endEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.FinishedAfterExtraTime };
      trigger.processEvent(endEvt, FIXTURE_ID, state);

      const settles = flatActions().filter((a) => a.type === "resolve_market_offchain");
      expect(settles.length).to.be.greaterThan(0);
      for (const s of settles) {
        expect((s as any).outcome).to.equal("No");
      }
    });

    it("FinishedAfterPenaltyShootout cleans up penalty shootout and settles OnChain/OffChain", () => {
      const soEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.PenaltyShootout };
      trigger.processEvent(soEvt, FIXTURE_ID, state);
      emittedActions = [];

      const endEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.FinishedAfterPenaltyShootout };
      trigger.processEvent(endEvt, FIXTURE_ID, state);

      const onchainSettles = flatActions().filter((a) => a.type === "resolve_market_onchain");
      expect(onchainSettles.length).to.be.greaterThan(0);
      for (const s of onchainSettles) {
        expect((s as any).settlementSeq).to.equal(0);
      }

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      expect(active).to.have.length(0);
    });
  });

  // ── 3. Timeout handling ──

  describe("checkTimeouts", () => {
    it("expired NextGoalSide → resolve_market_onchain", () => {
      const goalEvt: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
      trigger.processEvent(goalEvt, FIXTURE_ID, state);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const market = active.find((r) => r.marketType === MarketType.NextGoalSide);
      expect(market).to.exist;
      market!.expiresAt = Date.now() - 1;

      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.NextGoalSide);
      expect(settle).to.exist;
      expect((settle as any).settlementSeq).to.equal(0);
    });

    it("expired NextCorner → resolve_market_onchain with settlementSeq=0", () => {
      const cornerEvt: CornerEvent = { action: SoccerAction.Corner, participant: 1 };
      trigger.processEvent(cornerEvt, FIXTURE_ID, state);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const market = active.find((r) => r.marketType === MarketType.NextCorner);
      market!.expiresAt = Date.now() - 1;

      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.NextCorner);
      expect(settle).to.exist;
      expect((settle as any).settlementSeq).to.equal(0);
    });

    it("expired NextYellowCard → resolve_market_onchain with settlementSeq=0", () => {
      const ycEvt: YellowCardEvent = { action: SoccerAction.YellowCard, participant: 1 };
      trigger.processEvent(ycEvt, FIXTURE_ID, state);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const market = active.find((r) => r.marketType === MarketType.NextYellowCard);
      market!.expiresAt = Date.now() - 1;

      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.NextYellowCard);
      expect(settle).to.exist;
      expect((settle as any).settlementSeq).to.equal(0);
    });

    it("expired GoalInWindow → resolve_market_onchain(settlementSeq=0)", () => {
      trigger.startCronWindows(FIXTURE_ID);
      const cronState = makeMatchState({ matchClockMs: 300_000, status: StatusId.FirstHalf });
      const noopEvt: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
      trigger.processEvent(noopEvt, FIXTURE_ID, cronState);
      emittedActions = [];

      trigger.processEvent(noopEvt, FIXTURE_ID, makeMatchState({ matchClockMs: 600_000, status: StatusId.FirstHalf }));

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const windowMarket = active.find((r) => r.marketType === MarketType.GoalInWindow);
      expect(windowMarket).to.exist;
      windowMarket!.expiresAt = Date.now() - 1;
      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find(
        (a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.GoalInWindow,
      );
      expect(settle).to.exist;
      expect((settle as any).settlementSeq).to.equal(0);
    });

    it("expired PenaltyShot → resolve_market_onchain with settlementSeq=0", () => {
      const penalty: SoccerEvent = { action: SoccerAction.Penalty, participant: 1 } as any;
      trigger.processEvent(penalty, FIXTURE_ID, state);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const market = active.find((r) => r.marketType === MarketType.PenaltyShot);
      market!.expiresAt = Date.now() - 1;

      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find((a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.PenaltyShot);
      expect(settle).to.exist;
      expect((settle as any).settlementSeq).to.equal(0);
    });

    it("expired VARCheck → resolve_market_offchain(No)", () => {
      const varEvt: VarCheckEvent = { action: SoccerAction.Var, varType: VarType.Goal };
      trigger.processEvent(varEvt, FIXTURE_ID, state);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const market = active.find((r) => r.marketType === MarketType.VARCheck);
      market!.expiresAt = Date.now() - 1;

      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find((a) => a.type === "resolve_market_offchain" && (a as any).marketType === MarketType.VARCheck);
      expect(settle).to.exist;
      expect((settle as any).outcome).to.equal("No");
    });

    it("expired CornerInWindow → resolve_market_onchain(settlementSeq=0)", () => {
      trigger.startCronWindows(FIXTURE_ID);
      const s1 = makeMatchState({ matchClockMs: 180_000, status: StatusId.FirstHalf });
      const evt: CornerEvent = { action: SoccerAction.Corner, participant: 1 };
      trigger.processEvent(evt, FIXTURE_ID, s1);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const windowMarket = active.find((r) => r.marketType === MarketType.CornerInWindow);
      expect(windowMarket).to.exist;
      windowMarket!.expiresAt = Date.now() - 1;

      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find(
        (a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.CornerInWindow,
      );
      expect(settle).to.exist;
      expect((settle as any).settlementSeq).to.equal(0);
    });

    it("expired YellowCardInWindow → resolve_market_onchain(settlementSeq=0)", () => {
      trigger.startCronWindows(FIXTURE_ID);
      const s1 = makeMatchState({ matchClockMs: 300_000, status: StatusId.FirstHalf });
      const evt: YellowCardEvent = { action: SoccerAction.YellowCard, participant: 1 };
      trigger.processEvent(evt, FIXTURE_ID, s1);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const windowMarket = active.find((r) => r.marketType === MarketType.YellowCardInWindow);
      expect(windowMarket).to.exist;
      windowMarket!.expiresAt = Date.now() - 1;

      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find(
        (a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.YellowCardInWindow,
      );
      expect(settle).to.exist;
      expect((settle as any).settlementSeq).to.equal(0);
    });

    it("expired PenaltyShootoutShot → resolve_market_onchain(settlementSeq=0)", () => {
      const soEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.PenaltyShootout };
      trigger.processEvent(soEvt, FIXTURE_ID, state);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const market = active.find((r) => r.marketType === MarketType.PenaltyShootoutShot);
      expect(market).to.exist;
      market!.expiresAt = Date.now() - 1;

      const actions = trigger.checkTimeouts(FIXTURE_ID);
      const settle = actions.find(
        (a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.PenaltyShootoutShot,
      );
      expect(settle).to.exist;
      expect((settle as any).settlementSeq).to.equal(0);
    });

    it("settling market → immediate confirm_market", () => {
      const goalEvt: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
      trigger.processEvent(goalEvt, FIXTURE_ID, state);

      const active = trigger.getActiveMarkets(FIXTURE_ID);
      const market = active.find((r) => r.marketType === MarketType.NextGoalSide);
      market!.expiresAt = Date.now() - 1;

      const timeoutActions = trigger.checkTimeouts(FIXTURE_ID);
      expect(timeoutActions.find((a) => a.type === "resolve_market_onchain")).to.exist;

      const confirmActions = trigger.checkTimeouts(FIXTURE_ID);
      const confirm = confirmActions.find((a) => a.type === "confirm_market");
      expect(confirm).to.exist;
    });

    it("returns empty for unknown fixtureId", () => {
      const actions = trigger.checkTimeouts(9999);
      expect(actions).to.have.length(0);
    });
  });

  // ── 4. Cron windows ──

  describe("checkCronWindows", () => {
    it("opens GoalInWindow every 300s when cron enabled", () => {
      trigger.startCronWindows(FIXTURE_ID);

      const s1 = makeMatchState({ matchClockMs: 300_000, status: StatusId.FirstHalf });
      const evt: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
      trigger.processEvent(evt, FIXTURE_ID, s1);

      let opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.GoalInWindow);
      expect(opens).to.have.length(1);

      emittedActions = [];
      const s2 = makeMatchState({ matchClockMs: 599_000, status: StatusId.FirstHalf });
      trigger.processEvent(evt, FIXTURE_ID, s2);
      opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.GoalInWindow);
      expect(opens).to.have.length(0);

      emittedActions = [];
      const s3 = makeMatchState({ matchClockMs: 600_000, status: StatusId.FirstHalf });
      trigger.processEvent(evt, FIXTURE_ID, s3);
      opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.GoalInWindow);
      expect(opens).to.have.length(1);
    });

    it("opens CornerInWindow every 180s when cron enabled", () => {
      trigger.startCronWindows(FIXTURE_ID);

      const s1 = makeMatchState({ matchClockMs: 180_000, status: StatusId.FirstHalf });
      const evt: CornerEvent = { action: SoccerAction.Corner, participant: 1 };
      trigger.processEvent(evt, FIXTURE_ID, s1);

      const opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.CornerInWindow);
      expect(opens).to.have.length(1);
    });

    it("opens YellowCardInWindow every 300s when cron enabled", () => {
      trigger.startCronWindows(FIXTURE_ID);

      const s1 = makeMatchState({ matchClockMs: 300_000, status: StatusId.FirstHalf });
      const evt: YellowCardEvent = { action: SoccerAction.YellowCard, participant: 1 };
      trigger.processEvent(evt, FIXTURE_ID, s1);

      const opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.YellowCardInWindow);
      expect(opens).to.have.length(1);
    });

    it("does not open cron windows when disabled", () => {
      const s1 = makeMatchState({ matchClockMs: 300_000, status: StatusId.FirstHalf });
      const evt: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
      trigger.processEvent(evt, FIXTURE_ID, s1);

      const opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.GoalInWindow);
      expect(opens).to.have.length(0);
    });

    it("does not open cron windows when match is finished", () => {
      trigger.startCronWindows(FIXTURE_ID);

      const s1 = makeMatchState({ matchClockMs: 300_000, status: StatusId.FullTime });
      const evt: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
      trigger.processEvent(evt, FIXTURE_ID, s1);

      const opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.GoalInWindow);
      expect(opens).to.have.length(0);
    });
  });

  // ── 5. Market lifecycle ──

  describe("Market lifecycle", () => {
    it("getNextMarketSeq increments counter starting from 1", () => {
      expect(trigger.getNextMarketSeq(FIXTURE_ID)).to.equal(1);
      expect(trigger.getNextMarketSeq(FIXTURE_ID)).to.equal(2);
      expect(trigger.getNextMarketSeq(FIXTURE_ID)).to.equal(3);
    });

    it("getActiveMarkets returns only open status markets", () => {
      const goalEvt: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
      trigger.processEvent(goalEvt, FIXTURE_ID, state);

      let active = trigger.getActiveMarkets(FIXTURE_ID);
      expect(active).to.have.length(1);
      expect(active[0].status).to.equal("open");

      const goalEvt2: GoalEvent = { action: SoccerAction.Goal, participant: 2, goalType: GoalType.Shot };
      trigger.processEvent(goalEvt2, FIXTURE_ID, state);

      active = trigger.getActiveMarkets(FIXTURE_ID);
      expect(active).to.have.length(1);
      expect(active[0].marketType).to.equal(MarketType.NextGoalSide);
    });

    it("getActiveMarkets returns empty for unknown fixture", () => {
      expect(trigger.getActiveMarkets(9999)).to.have.length(0);
    });

    it("startCronWindows/stopCronWindows toggle cron behavior", () => {
      trigger.startCronWindows(FIXTURE_ID);

      const s1 = makeMatchState({ matchClockMs: 300_000, status: StatusId.FirstHalf });
      const evt: GoalEvent = { action: SoccerAction.Goal, participant: 1, goalType: GoalType.Shot };
      trigger.processEvent(evt, FIXTURE_ID, s1);

      let opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.GoalInWindow);
      expect(opens).to.have.length(1);

      trigger.stopCronWindows(FIXTURE_ID);
      emittedActions = [];

      const s2 = makeMatchState({ matchClockMs: 600_000, status: StatusId.FirstHalf });
      trigger.processEvent(evt, FIXTURE_ID, s2);

      opens = flatActions().filter((a) => a.type === "open_market" && (a as any).marketType === MarketType.GoalInWindow);
      expect(opens).to.have.length(0);
    });
  });

  // ── 6. MARKET_TIMINGS constants ──

  describe("MARKET_TIMINGS", () => {
    it("has entries for all market types", () => {
      const expectedTypes = [
        "NextGoalSide", "GoalInWindow", "NextCorner", "CornerInWindow",
        "NextYellowCard", "YellowCardInWindow", "RedCardInMatch",
        "PenaltyShootoutShot", "PenaltyShot", "VARCheck",
      ];
      for (const t of expectedTypes) {
        expect(MARKET_TIMINGS[t]).to.exist;
        expect(MARKET_TIMINGS[t].lock).to.be.a("number");
        expect(MARKET_TIMINGS[t].deadline).to.be.a("number");
      }
    });
  });

  // ── 7. Penalty shootout integration ──

  describe("Penalty shootout integration", () => {
    it("PenaltyOutcome in shootout mode settles both PenaltyShot and PenaltyShootoutShot", () => {
      const soEvt: StatusChangeEvent = { action: SoccerAction.Status, statusId: StatusId.PenaltyShootout };
      trigger.processEvent(soEvt, FIXTURE_ID, state);
      emittedActions = [];

      const penalty: SoccerEvent = { action: SoccerAction.Penalty, participant: 1 } as any;
      trigger.processEvent(penalty, FIXTURE_ID, state);
      emittedActions = [];

      const outcome: PenaltyOutcomeEvent = {
        action: SoccerAction.PenaltyOutcome,
        participant: 1,
        outcome: "Scored",
      };
      trigger.processEvent(outcome, FIXTURE_ID, state);

      const all = flatActions();
      const penSettle = all.find(
        (a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.PenaltyShot,
      );
      expect(penSettle).to.exist;
      expect((penSettle as any).targetStatKey).to.equal(159);

      const soSettle = all.find(
        (a) => a.type === "resolve_market_onchain" && (a as any).marketType === MarketType.PenaltyShootoutShot,
      );
      expect(soSettle).to.exist;
      expect((soSettle as any).settlementSeq).to.equal(0);

      const soOpen = all.find(
        (a) => a.type === "open_market" && (a as any).marketType === MarketType.PenaltyShootoutShot,
      );
      expect(soOpen).to.exist;
    });
  });
});
