import type { OrderSide } from './clobTypes';

export const ORDER_PROTOCOL_VERSION = 1;

export interface UnsignedOrder {
  version: number;
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
  order_pda: string;
  create_tx_signature: string;
}

export interface SignedOrder {
  payload: UnsignedOrder;
  signature: string;
}

export interface UnsignedCancellation {
  version: number;
  network: string;
  program_id: string;
  owner: string;
  order_id: string;
  nonce: string;
  expires_at: number;
  order_pda: string;
  cancel_tx_signature: string;
}

export interface SignedCancellation {
  payload: UnsignedCancellation;
  signature: string;
}

// This field order is the protocol. Do not use JSON.stringify on arbitrary objects:
// relayer and browser must sign exactly these UTF-8 bytes.
export function canonicalOrderMessage(order: UnsignedOrder): string {
  return [
    'kicktick-clob-order',
    `version=${order.version}`,
    `network=${order.network}`,
    `program_id=${order.program_id}`,
    `market=${order.market}`,
    `owner=${order.owner}`,
    `side=${order.side}`,
    `outcome_index=${order.outcome_index}`,
    `price_bps=${order.price_bps}`,
    `quantity=${order.quantity}`,
    `nonce=${order.nonce}`,
    `expires_at=${order.expires_at}`,
    `order_pda=${order.order_pda}`,
    `create_tx_signature=${order.create_tx_signature}`,
    '',
  ].join('\n');
}

export function canonicalCancellationMessage(cancel: UnsignedCancellation): string {
  return [
    'kicktick-clob-cancellation',
    `version=${cancel.version}`,
    `network=${cancel.network}`,
    `program_id=${cancel.program_id}`,
    `owner=${cancel.owner}`,
    `order_id=${cancel.order_id}`,
    `nonce=${cancel.nonce}`,
    `expires_at=${cancel.expires_at}`,
    `order_pda=${cancel.order_pda}`,
    `cancel_tx_signature=${cancel.cancel_tx_signature}`,
    '',
  ].join('\n');
}

export function validateOrder(order: UnsignedOrder): void {
  if (!/^[1-9][0-9]*$/.test(order.quantity)) throw new Error('Quantity must be a positive integer string.');
  if (order.price_bps < 100 || order.price_bps > 9900 || order.price_bps % 100 !== 0) {
    throw new Error('Price must be between 1% and 99% in 1% ticks.');
  }
  if (!Number.isInteger(order.outcome_index) || order.outcome_index < 0 || order.outcome_index > 2) throw new Error('Invalid outcome.');
  if (!/^[1-9][0-9]*$/.test(order.nonce)) throw new Error('Order nonce must be a positive decimal string.');
  if (order.expires_at <= Math.floor(Date.now() / 1000)) throw new Error('Order expiry must be in the future.');
}

export async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message) as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function orderId(message: string, signature: Uint8Array): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const joined = new Uint8Array(bytes.length + signature.length);
  joined.set(bytes); joined.set(signature, bytes.length);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(joined) as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function signOrder(
  order: UnsignedOrder,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<SignedOrder> {
  validateOrder(order);
  const message = canonicalOrderMessage(order);
  const signature = await signMessage(new TextEncoder().encode(message));
  return { payload: order, signature: bytesToBase64(signature) };
}

export async function signCancellation(
  cancellation: UnsignedCancellation,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<SignedCancellation> {
  const signature = await signMessage(new TextEncoder().encode(canonicalCancellationMessage(cancellation)));
  return { payload: cancellation, signature: bytesToBase64(signature) };
}
