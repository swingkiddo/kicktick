export type FillStatus =
  | "MATCHED"
  | "SUBMITTED"
  | "UNKNOWN"
  | "CONFIRMED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL";

export interface Fill {
  id: string;
  market: string;
  market_sequence: bigint;
  kind: "DIRECT" | "COMPLETE_SET";
  maker_order_ids: string[];
  taker_order_ids: string[];
  buyer?: string;
  seller?: string;
  outcome_index?: number;
  prices_bps: number[];
  quantity: bigint;
  status: FillStatus;
  tx_signature?: string;
  error?: string;
  created_at: number;
  updated_at: number;
}
