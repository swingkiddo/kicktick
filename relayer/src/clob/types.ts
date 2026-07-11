export const PRICE_SCALE_BPS = 10_000;
export const PRICE_TICK_BPS = 100;
export const MIN_PRICE_BPS = 100;
export const MAX_PRICE_BPS = 9_900;
export const MIN_TRADE_QUANTITY = 100n;

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED" | "EXPIRED" | "REJECTED";
export type { Fill, FillStatus } from "../domain/settlement/types";
export type { MarketRecord, MarketState } from "../domain/markets";

export interface OrderPayload {
  version: 1;
  network: string;
  program_id: string;
  market: string;
  owner: string;
  side: OrderSide;
  outcome_index: number;
  price_bps: number;
  quantity: string;
  nonce: string;
  expires_at: number;
}

export interface SignedOrder {
  payload: OrderPayload;
  /** Base64-encoded Ed25519 detached signature over canonicalOrderMessage(payload). */
  signature: string;
}

export interface CancellationPayload {
  version: 1;
  network: string;
  program_id: string;
  owner: string;
  order_id: string;
  nonce: string;
  expires_at: number;
}

export interface SignedCancellation {
  payload: CancellationPayload;
  signature: string;
}

export interface StoredOrder extends OrderPayload {
  id: string;
  signature: string;
  original_quantity: bigint;
  remaining_quantity: bigint;
  pending_quantity: bigint;
  status: OrderStatus;
  priority_at: number;
  created_at: number;
  updated_at: number;
}

/** Last safely processed TxLINE score sequence for a fixture. */
export interface FixtureCursor {
  fixture_id: string;
  last_seq: number;
  updated_at: number;
}

/** Durable relayer intent. A process restart must never erase a required lifecycle step. */
export type MarketActionStatus = "PENDING" | "RUNNING" | "CONFIRMED" | "FAILED";

export interface MarketActionRecord {
  id: string;
  fixture_id: string;
  market: string;
  action_type: "RESOLVE_ONCHAIN" | "RESOLVE_OFFCHAIN" | "CONFIRM";
  payload_json: string;
  status: MarketActionStatus;
  attempts: number;
  error?: string;
  created_at: number;
  updated_at: number;
}
