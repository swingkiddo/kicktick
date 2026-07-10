import { EventEmitter } from "events";
import { PublicKey } from "@solana/web3.js";
import { AnchorClient, SettleProofArgs } from "../clients/anchor-client";
import { ProofGatherer, ProofData, ProofNotReadyError } from "./proof-gatherer";
import { MarketType } from "../market/event-parser";
import { TriggerAction } from "../market/triggers";

export interface CrankStatus {
  fixtureId: number;
  marketSeq: number;
  action: string;
  status: "pending" | "sent" | "confirmed" | "failed";
  txSig?: string;
  error?: string;
  timestamp: number;
}

export interface CrankOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  confirmCommitment?: string;
  proofMaxAttempts?: number;
  proofBackoffMs?: number[];
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_PROOF_MAX_ATTEMPTS = 4;
const DEFAULT_PROOF_BACKOFF_MS = [0, 1000, 2000, 4000];

function outcomeToWinner(outcome: string): number {
  switch (outcome) {
    case "Home": return 1;
    case "Away": return 2;
    case "NoGoal": return 3;
    case "Yes": return 1;
    case "No": return 2;
    case "Cancelled": return 0;
    default: return 2;
  }
}

export class Crank extends EventEmitter {
  private statuses = new Map<string, CrankStatus>();
  private maxRetries: number;
  private retryDelayMs: number;
  private proofMaxAttempts: number;
  private proofBackoffMs: number[];

  constructor(
    private anchorClient: AnchorClient,
    private proofGatherer: ProofGatherer,
    options?: CrankOptions,
  ) {
    super();
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.proofMaxAttempts = options?.proofMaxAttempts ?? DEFAULT_PROOF_MAX_ATTEMPTS;
    this.proofBackoffMs = options?.proofBackoffMs ?? DEFAULT_PROOF_BACKOFF_MS;
  }

  private statusKey(fixtureId: number, marketSeq: number): string {
    return `${fixtureId}:${marketSeq}`;
  }

  private emitStatus(
    fixtureId: number,
    marketSeq: number,
    action: string,
    status: CrankStatus["status"],
    txSig?: string,
    error?: string,
  ): void {
    const key = this.statusKey(fixtureId, marketSeq);
    const prev = this.statuses.get(key);
    const entry: CrankStatus = {
      fixtureId,
      marketSeq,
      action,
      status,
      txSig: txSig ?? prev?.txSig,
      error: error ?? prev?.error,
      timestamp: Date.now(),
    };
    this.statuses.set(key, entry);
    this.emit("status", entry);
  }

  async executeAction(action: TriggerAction): Promise<void> {
    const { fixtureId, marketSeq } = action;
    switch (action.type) {
      case "open_market":
        return this.executeOpenMarket(fixtureId, marketSeq, action);
      case "resolve_market_onchain":
        return this.executeSettleOnchain(fixtureId, marketSeq, action);
      case "resolve_market_offchain":
        return this.executeSettleOffchain(fixtureId, marketSeq, action);
      case "confirm_market":
        return this.executeConfirmMarket(fixtureId, marketSeq, action);
    }
  }

  async executeActions(actions: TriggerAction[]): Promise<void> {
    for (const action of actions) {
      await this.executeAction(action);
    }
  }

  getStatus(fixtureId: number, marketSeq: number): CrankStatus | undefined {
    return this.statuses.get(this.statusKey(fixtureId, marketSeq));
  }

  getPending(): CrankStatus[] {
    return Array.from(this.statuses.values()).filter(
      (s) => s.status === "pending" || s.status === "sent",
    );
  }

  private async executeWithRetry(fn: () => Promise<string>): Promise<string> {
    let lastError: Error;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          await new Promise((r) =>
            setTimeout(r, this.retryDelayMs * Math.pow(2, attempt)),
          );
        }
      }
    }
    throw lastError!;
  }

  private async gatherProofWithRetry(
    fixtureId: number,
    seq: number,
    statKey: number,
    period: number,
  ): Promise<ProofData> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.proofMaxAttempts; attempt++) {
      const backoff = this.proofBackoffMs[attempt] ?? 0;
      if (backoff > 0) {
        await new Promise((r) => setTimeout(r, backoff));
      }
      try {
        return await this.proofGatherer.gatherProof(fixtureId, seq, statKey, period);
      } catch (err) {
        if (err instanceof ProofNotReadyError && attempt < this.proofMaxAttempts - 1) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw lastError ?? new Error("gatherProofWithRetry exhausted without error");
  }

  private async executeOpenMarket(
    fixtureId: number,
    marketSeq: number,
    action: TriggerAction & { type: "open_market" },
  ): Promise<void> {
    this.emitStatus(fixtureId, marketSeq, "open_market", "pending");

    try {
      const txSig = await this.executeWithRetry(() =>
        this.anchorClient.initMarket(
          fixtureId,
          action.marketType,
          marketSeq,
          action.deadlineSeconds,
        ),
      );
      this.emitStatus(fixtureId, marketSeq, "open_market", "confirmed", txSig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitStatus(fixtureId, marketSeq, "open_market", "failed", undefined, msg);
      this.emit("error", err instanceof Error ? err : new Error(String(err)), action);
    }
  }

  private async executeSettleOnchain(
    fixtureId: number,
    marketSeq: number,
    action: TriggerAction & { type: "resolve_market_onchain" },
  ): Promise<void> {
    const marketAddress = AnchorClient.deriveMarketPda(
      BigInt(fixtureId),
      AnchorClient.marketTypeIndex(action.marketType),
      BigInt(marketSeq),
      this.anchorClient.programId,
    )[0].toBase58();
    this.emitStatus(fixtureId, marketSeq, "settle_onchain", "pending");

    try {
      const keys = this.proofGatherer.getStatKeysForMarket(action.marketType);
      if (keys.length === 0) return;

      // When targetStatKey is provided (event-triggered), use only that key
      const statKey = action.targetStatKey ?? keys[0].statKey;
      const period = keys.find(k => k.statKey === statKey)?.period ?? keys[0].period;

      const firstProof = await this.gatherProofWithRetry(
        fixtureId,
        action.settlementSeq,
        statKey,
        period,
      );

      const predicate = this.proofGatherer.buildPredicate(0);

      const proofArgs: SettleProofArgs = {
        ts: firstProof.ts,
        fixtureSummary: {
          fixtureId: firstProof.fixtureSummary.fixture_id,
          updateStats: {
            updateCount: firstProof.fixtureSummary.update_stats.update_count,
            minTimestamp: firstProof.fixtureSummary.update_stats.min_timestamp,
            maxTimestamp: firstProof.fixtureSummary.update_stats.max_timestamp,
          },
          eventsSubTreeRoot: firstProof.fixtureSummary.events_sub_tree_root,
        },
        fixtureProof: firstProof.fixtureProof.map((n) => ({
          hash: n.hash,
          isRightSibling: n.is_right_sibling,
        })),
        mainTreeProof: firstProof.mainTreeProof.map((n) => ({
          hash: n.hash,
          isRightSibling: n.is_right_sibling,
        })),
        predicate: {
          threshold: predicate.threshold,
          comparison: predicate.comparison as "GreaterThan" | "LessThan" | "EqualTo",
        },
        statA: {
          statToProve: {
            key: firstProof.statA.stat_to_prove.key,
            value: firstProof.statA.stat_to_prove.value,
            period: firstProof.statA.stat_to_prove.period,
          },
          eventStatRoot: firstProof.statA.event_stat_root,
          statProof: firstProof.statA.stat_proof.map((n) => ({
            hash: n.hash,
            isRightSibling: n.is_right_sibling,
          })),
        },
      };

      if (action.targetStatKey) {
        // Event-triggered settle: single stat key, no statB needed
      } else if (keys.length === 2) {
        const secondProof = await this.gatherProofWithRetry(
          fixtureId,
          action.settlementSeq,
          keys[1].statKey,
          keys[1].period,
        );

        proofArgs.statB = {
          statToProve: {
            key: secondProof.statA.stat_to_prove.key,
            value: secondProof.statA.stat_to_prove.value,
            period: secondProof.statA.stat_to_prove.period,
          },
          eventStatRoot: secondProof.statA.event_stat_root,
          statProof: secondProof.statA.stat_proof.map((n) => ({
            hash: n.hash,
            isRightSibling: n.is_right_sibling,
          })),
        };

        // PenaltyShootoutShot uses two-stat with op="Add" (single CPI call)
        // Ternary markets (NextGoalSide/NextCorner/NextYellowCard): no op → two separate CPI calls
        if (action.marketType === MarketType.PenaltyShootoutShot) {
          proofArgs.op = "Add";
        }
      }

      const txSig = await this.executeWithRetry(() =>
        this.anchorClient.resolveMarketWithProof(marketAddress, proofArgs),
      );

      this.emitStatus(fixtureId, marketSeq, "settle_onchain", "confirmed", txSig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitStatus(fixtureId, marketSeq, "settle_onchain", "failed", undefined, msg);
      this.emit("error", err instanceof Error ? err : new Error(String(err)), action);
    }
  }

  private async executeSettleOffchain(
    fixtureId: number,
    marketSeq: number,
    action: TriggerAction & { type: "resolve_market_offchain" },
  ): Promise<void> {
    const marketAddress = AnchorClient.deriveMarketPda(
      BigInt(fixtureId),
      AnchorClient.marketTypeIndex(action.marketType),
      BigInt(marketSeq),
      this.anchorClient.programId,
    )[0].toBase58();
    this.emitStatus(fixtureId, marketSeq, "settle_offchain", "pending");

    try {
      const txSig = await this.executeWithRetry(() =>
        this.anchorClient.resolveMarketOffchain(
          marketAddress,
          outcomeToWinner(action.outcome),
        ),
      );

      this.emitStatus(fixtureId, marketSeq, "settle_offchain", "confirmed", txSig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitStatus(fixtureId, marketSeq, "settle_offchain", "failed", undefined, msg);
      this.emit("error", err instanceof Error ? err : new Error(String(err)), action);
    }
  }

  private async executeConfirmMarket(
    fixtureId: number,
    marketSeq: number,
    action: TriggerAction & { type: "confirm_market" },
  ): Promise<void> {
    const marketAddress = AnchorClient.deriveMarketPda(
      BigInt(fixtureId),
      AnchorClient.marketTypeIndex(action.marketType),
      BigInt(marketSeq),
      this.anchorClient.programId,
    )[0].toBase58();
    this.emitStatus(fixtureId, marketSeq, "confirm_market", "pending");

    try {
      const txSig = await this.executeWithRetry(() =>
        this.anchorClient.confirmMarket(marketAddress),
      );

      this.emitStatus(fixtureId, marketSeq, "confirm_market", "confirmed", txSig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emitStatus(fixtureId, marketSeq, "confirm_market", "failed", undefined, msg);
      this.emit("error", err instanceof Error ? err : new Error(String(err)), action);
    }
  }
}
