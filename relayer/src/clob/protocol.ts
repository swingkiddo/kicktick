import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  CancellationPayload,
  OrderPayload,
  SignedCancellation,
  SignedOrder,
  MAX_PRICE_BPS,
  MIN_TRADE_QUANTITY,
  MIN_PRICE_BPS,
  PRICE_TICK_BPS,
} from "./types";

const ORDER_DOMAIN = "kicktick-clob-order";
const CANCELLATION_DOMAIN = "kicktick-clob-cancellation";

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

function canonical(domain: string, fields: Record<string, string | number>): Uint8Array {
  const body = Object.entries(fields).map(([key, value]) => `${key}=${value}`).join("\n");
  return Buffer.from(`${domain}\n${body}\n`, "utf8");
}

/** Canonical bytes signed by wallet clients. Field order is protocol, not JSON insertion order. */
export function canonicalOrderMessage(payload: OrderPayload): Uint8Array {
  return canonical(ORDER_DOMAIN, {
    version: payload.version,
    network: payload.network,
    program_id: payload.program_id,
    market: payload.market,
    owner: payload.owner,
    side: payload.side,
    outcome_index: payload.outcome_index,
    price_bps: payload.price_bps,
    quantity: payload.quantity,
    nonce: payload.nonce,
    expires_at: payload.expires_at,
    order_pda: payload.order_pda,
    create_tx_signature: payload.create_tx_signature,
  });
}

export function canonicalCancellationMessage(payload: CancellationPayload): Uint8Array {
  return canonical(CANCELLATION_DOMAIN, {
    version: payload.version,
    network: payload.network,
    program_id: payload.program_id,
    owner: payload.owner,
    order_id: payload.order_id,
    nonce: payload.nonce,
    expires_at: payload.expires_at,
    order_pda: payload.order_pda,
    cancel_tx_signature: payload.cancel_tx_signature,
  });
}

export function orderId(payload: OrderPayload, signature: Uint8Array): string {
  return createHash("sha256").update(canonicalOrderMessage(payload)).update(signature).digest("hex");
}

function positiveDecimal(value: string, name: string): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) throw new ProtocolError(`${name} must be a positive decimal string`);
  return BigInt(value);
}

function validateBase58(value: string, name: string): void {
  try { new PublicKey(value); } catch { throw new ProtocolError(`${name} must be a valid Solana public key`); }
}

function validateCommon(payload: { version: number; network: string; program_id: string; owner: string; nonce: string; expires_at: number }, now: number): void {
  if (payload.version !== 1) throw new ProtocolError("unsupported protocol version");
  if (!payload.network) throw new ProtocolError("network is required");
  validateBase58(payload.program_id, "program_id");
  validateBase58(payload.owner, "owner");
  positiveDecimal(payload.nonce, "nonce");
  if (!Number.isSafeInteger(payload.expires_at) || payload.expires_at <= now) throw new ProtocolError("message has expired");
}

export function validateOrderPayload(payload: OrderPayload, now = Math.floor(Date.now() / 1000)): bigint {
  validateCommon(payload, now);
  validateBase58(payload.market, "market");
  validateBase58(payload.order_pda, "order_pda");
  if (!payload.create_tx_signature) throw new ProtocolError("create_tx_signature is required");
  if (payload.side !== "BUY" && payload.side !== "SELL") throw new ProtocolError("side must be BUY or SELL");
  if (!Number.isInteger(payload.outcome_index) || payload.outcome_index < 0 || payload.outcome_index > 2) throw new ProtocolError("outcome_index must be 0, 1, or 2");
  if (!Number.isInteger(payload.price_bps) || payload.price_bps < MIN_PRICE_BPS || payload.price_bps > MAX_PRICE_BPS || payload.price_bps % PRICE_TICK_BPS !== 0) {
    throw new ProtocolError("price_bps must be a 100 bps tick between 100 and 9900");
  }
  const quantity = positiveDecimal(payload.quantity, "quantity");
  if (quantity < MIN_TRADE_QUANTITY) throw new ProtocolError(`quantity must be at least ${MIN_TRADE_QUANTITY}`);
  return quantity;
}

export function validateCancellationPayload(payload: CancellationPayload, now = Math.floor(Date.now() / 1000)): void {
  validateCommon(payload, now);
  if (!/^[a-f0-9]{64}$/.test(payload.order_id)) throw new ProtocolError("order_id must be a SHA-256 hex digest");
  validateBase58(payload.order_pda, "order_pda");
  if (!payload.cancel_tx_signature) throw new ProtocolError("cancel_tx_signature is required");
}

function decodeSignature(value: string): Uint8Array {
  let signature: Buffer;
  try { signature = Buffer.from(value, "base64"); } catch { throw new ProtocolError("signature must be base64"); }
  if (signature.length !== nacl.sign.signatureLength) throw new ProtocolError("signature must be 64 bytes");
  return signature;
}

function verify(owner: string, bytes: Uint8Array, signature: Uint8Array): void {
  const publicKey = new PublicKey(owner).toBytes();
  if (!nacl.sign.detached.verify(bytes, signature, publicKey)) throw new ProtocolError("invalid Ed25519 signature");
}

export function verifySignedOrder(order: SignedOrder, now?: number): { id: string; quantity: bigint } {
  const quantity = validateOrderPayload(order.payload, now);
  const signature = decodeSignature(order.signature);
  verify(order.payload.owner, canonicalOrderMessage(order.payload), signature);
  return { id: orderId(order.payload, signature), quantity };
}

export function verifySignedCancellation(cancellation: SignedCancellation, now?: number): void {
  validateCancellationPayload(cancellation.payload, now);
  verify(cancellation.payload.owner, canonicalCancellationMessage(cancellation.payload), decodeSignature(cancellation.signature));
}
