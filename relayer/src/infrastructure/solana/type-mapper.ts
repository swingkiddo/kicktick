import { BN } from "@anchor-lang/core";

export type Comparison = "GreaterThan" | "LessThan" | "EqualTo";
export type BinaryExpression = "Add" | "Subtract";
export interface SettleProofArgs {
  ts: number;
  fixtureSummary: { fixtureId: number; updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number }; eventsSubTreeRoot: number[] };
  fixtureProof: { hash: number[]; isRightSibling: boolean }[];
  mainTreeProof: { hash: number[]; isRightSibling: boolean }[];
  predicate: { threshold: number; comparison: Comparison };
  statA: { statToProve: { key: number; value: number; period: number }; eventStatRoot: number[]; statProof: { hash: number[]; isRightSibling: boolean }[] };
  statB?: { statToProve: { key: number; value: number; period: number }; eventStatRoot: number[]; statProof: { hash: number[]; isRightSibling: boolean }[] };
  op?: BinaryExpression;
}

const VARIANTS: Record<string, string> = {
  NextGoalSide: "nextGoalSide", GoalInWindow: "goalInWindow", NextCorner: "nextCorner", CornerInWindow: "cornerInWindow",
  NextYellowCard: "nextYellowCard", YellowCardInWindow: "yellowCardInWindow", RedCardInMatch: "redCardInMatch",
  PenaltyShootoutShot: "penaltyShootoutShot", PenaltyShot: "penaltyShot", VARCheck: "varCheck",
  GreaterThan: "greaterThan", LessThan: "lessThan", EqualTo: "equalTo", Add: "add", Subtract: "subtract",
};
export const anchorVariant = (value: string): string => VARIANTS[value] ?? value.charAt(0).toLowerCase() + value.slice(1);
const nodes = (value: { hash: number[]; isRightSibling: boolean }[]) => value.map(node => ({ hash: node.hash, isRightSibling: node.isRightSibling }));
const term = (value: SettleProofArgs["statA"]) => ({
  statToProve: { key: new BN(value.statToProve.key), value: new BN(value.statToProve.value), period: new BN(value.statToProve.period) },
  eventStatRoot: value.eventStatRoot,
  statProof: nodes(value.statProof),
});
export function mapSettleProofArgs(value: SettleProofArgs): unknown {
  return {
    ts: new BN(value.ts),
    fixtureSummary: {
      fixtureId: new BN(value.fixtureSummary.fixtureId),
      updateStats: {
        updateCount: new BN(value.fixtureSummary.updateStats.updateCount),
        minTimestamp: new BN(value.fixtureSummary.updateStats.minTimestamp),
        maxTimestamp: new BN(value.fixtureSummary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: value.fixtureSummary.eventsSubTreeRoot,
    },
    fixtureProof: nodes(value.fixtureProof), mainTreeProof: nodes(value.mainTreeProof),
    predicate: { threshold: new BN(value.predicate.threshold), comparison: { [anchorVariant(value.predicate.comparison)]: {} } },
    statA: term(value.statA), statB: value.statB ? term(value.statB) : null,
    op: value.op ? { [anchorVariant(value.op)]: {} } : null,
  };
}
