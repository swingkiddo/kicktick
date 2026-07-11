import { randomBytes } from "crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { WebSocket } from "ws";
import { WsClientMessage, WsServer } from "../api/ws-server";
import { canonicalOrderMessage, ProtocolError, verifySignedCancellation, verifySignedOrder } from "./protocol";
import { MatchingEngine } from "./matching-engine";
import { ClobStore } from "./store";
import { CancellationPayload, OrderPayload, SignedCancellation, SignedOrder, StoredOrder } from "./types";

interface Session { challenge?: string; owner?: string; messages: number[]; marketSubscriptions: Set<string>; bookSubscriptions: Set<string>; }
export interface ClobWsApiOptions {
  network: string;
  programId: string;
  onFills?: (market: string) => Promise<void> | void;
  connection: Connection;
}

const CHALLENGE_DOMAIN = "kicktick-clob-auth";
const nowSeconds = () => Math.floor(Date.now() / 1000);
const send = (ws: WebSocket, type: string, data: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type, data }));

function canonicalChallenge(owner: string, challenge: string): Uint8Array {
  return Buffer.from(`${CHALLENGE_DOMAIN}\nowner=${owner}\nchallenge=${challenge}\n`, "utf8");
}

/** Wallet-authenticated CLOB command adapter on top of the existing public SSE WebSocket server. */
export class ClobWsApi {
  private readonly sessions = new Map<WebSocket, Session>();

  private discriminator(name: string): Buffer { return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8); }

  private async verifyCreateOrder(payload: OrderPayload): Promise<void> {
    const tx = await this.options.connection.getParsedTransaction(payload.create_tx_signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) throw new ProtocolError("create transaction is not confirmed");
    const program = new PublicKey(this.options.programId);
    const ix = tx.transaction.message.instructions.find((candidate: any) => candidate.programId?.equals(program) && bs58.decode(candidate.data).subarray(0, 8).equals(this.discriminator("create_order")));
    if (!ix) throw new ProtocolError("transaction did not call create_order");
    const accounts = (ix as any).accounts as PublicKey[];
    if (!accounts?.[0]?.equals(new PublicKey(payload.owner)) || !accounts?.[3]?.equals(new PublicKey(payload.market)) || !accounts?.[4]?.equals(new PublicKey(payload.order_pda))) throw new ProtocolError("create_order accounts do not match payload");
    const info = await this.options.connection.getAccountInfo(new PublicKey(payload.order_pda), "confirmed");
    if (!info || info.data.length < 110) throw new ProtocolError("order PDA is missing");
    const d = info.data;
    const owner = new PublicKey(d.subarray(8, 40));
    const market = new PublicKey(d.subarray(40, 72));
    const side = d[72] === 0 ? "BUY" : "SELL";
    const outcome = d[73];
    const price = d.readUInt16LE(74);
    const quantity = d.readBigUInt64LE(76);
    const nonce = d.readBigUInt64LE(92);
    if (!owner.equals(new PublicKey(payload.owner)) || !market.equals(new PublicKey(payload.market)) || side !== payload.side || outcome !== payload.outcome_index || price !== payload.price_bps || quantity !== BigInt(payload.quantity) || nonce !== BigInt(payload.nonce)) throw new ProtocolError("on-chain order does not match signed payload");
  }

  private async verifyCancelTransaction(payload: CancellationPayload): Promise<void> {
    const tx = await this.options.connection.getParsedTransaction(payload.cancel_tx_signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) throw new ProtocolError("cancel transaction is not confirmed");
    const program = new PublicKey(this.options.programId);
    const ix = tx.transaction.message.instructions.find((candidate: any) => candidate.programId?.equals(program) && bs58.decode(candidate.data).subarray(0, 8).equals(this.discriminator("cancel_order")));
    if (!ix) throw new ProtocolError("transaction did not call cancel_order");
    const accounts = (ix as any).accounts as PublicKey[];
    if (!accounts?.[0]?.equals(new PublicKey(payload.owner)) || !accounts?.[3]?.equals(new PublicKey(payload.order_pda))) throw new ProtocolError("cancel_order accounts do not match payload");
  }

  constructor(private readonly ws: WsServer, private readonly store: ClobStore, private readonly engine: MatchingEngine, private readonly options: ClobWsApiOptions) {
    ws.on("connection", (socket: WebSocket) => this.sessions.set(socket, { messages: [], marketSubscriptions: new Set(), bookSubscriptions: new Set() }));
    ws.on("message", (socket: WebSocket, message: WsClientMessage) => this.handle(socket, message));
  }

  publishMarket(market: string): void {
    const entry = this.store.getMarket(market);
    if (!entry) return;
    this.publish("market_update", market, entry, "marketSubscriptions");
    this.publish("orderbook", market, this.orderbook(market), "bookSubscriptions");
  }

  private handle(ws: WebSocket, message: WsClientMessage): void {
    const session = this.sessions.get(ws);
    if (!session || !this.withinRateLimit(session)) { send(ws, "error", { code: "RATE_LIMITED", message: "too many messages" }); return; }
    switch (message.type) {
      case "auth_challenge": return this.challenge(ws, session, message.data.owner);
      case "auth_response": return this.authenticate(ws, session, message.data.owner, message.data.signature);
      case "subscribe_market": session.marketSubscriptions.add(message.data.market); return this.sendMarket(ws, message.data.market);
      case "unsubscribe_market": session.marketSubscriptions.delete(message.data.market); return;
      case "subscribe_orderbook": session.bookSubscriptions.add(message.data.market); send(ws, "orderbook", this.orderbook(message.data.market)); return;
      case "submit_order": void this.submitOrder(ws, session, message.data); return;
      case "cancel_order": void this.cancelOrder(ws, session, message.data); return;
      case "cancel_all": return this.cancelAll(ws, session, message.data?.market);
      default: return;
    }
  }

  private withinRateLimit(session: Session): boolean {
    const cutoff = Date.now() - 1_000;
    session.messages = session.messages.filter(timestamp => timestamp >= cutoff);
    if (session.messages.length >= 30) return false;
    session.messages.push(Date.now());
    return true;
  }

  private challenge(ws: WebSocket, session: Session, owner: string): void {
    try { new PublicKey(owner); } catch { send(ws, "error", { code: "INVALID_OWNER", message: "owner must be a public key" }); return; }
    session.owner = owner;
    session.challenge = randomBytes(32).toString("base64url");
    send(ws, "auth_challenge", { owner, challenge: session.challenge, expires_at: nowSeconds() + 60 });
  }

  private authenticate(ws: WebSocket, session: Session, owner: string, signatureText: string): void {
    try {
      if (!session.challenge || session.owner !== owner) throw new ProtocolError("request a challenge before authenticating");
      const signature = Buffer.from(signatureText, "base64");
      if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(canonicalChallenge(owner, session.challenge), signature, new PublicKey(owner).toBytes())) {
        throw new ProtocolError("invalid auth signature");
      }
      session.challenge = undefined;
      send(ws, "authenticated", { owner });
      send(ws, "private_orders", this.store.listOwnerOrders(owner));
    } catch (error) { send(ws, "error", { code: "AUTH_FAILED", message: error instanceof Error ? error.message : String(error) }); }
  }

  private async submitOrder(ws: WebSocket, session: Session, data: unknown): Promise<void> {
    try {
      this.requireAuth(session);
      const order = data as SignedOrder;
      if (order.payload.owner !== session.owner) throw new ProtocolError("authenticated wallet does not own order");
      if (order.payload.network !== this.options.network || order.payload.program_id !== this.options.programId) throw new ProtocolError("order network or program does not match relayer");
      const verified = verifySignedOrder(order);
      await this.verifyCreateOrder(order.payload);
      const market = this.store.getMarket(order.payload.market);
      if (!market || market.state !== "OPEN" || market.outcome_count <= order.payload.outcome_index || nowSeconds() >= market.expires_at - 2) throw new ProtocolError("market is not accepting orders");
      const now = Date.now();
      const stored: StoredOrder = { ...order.payload, id: verified.id, signature: order.signature, original_quantity: verified.quantity, remaining_quantity: verified.quantity, pending_quantity: 0n, status: "OPEN", priority_at: now, created_at: now, updated_at: now };
      this.store.insertOrder(stored);
      send(ws, "order_ack", { order_id: stored.id, status: stored.status, remaining_quantity: stored.remaining_quantity.toString() });
      this.publishMarket(stored.market);
      const result = this.engine.match(market);
      if (result.fills.length) void Promise.resolve(this.options.onFills?.(market.market)).catch(() => undefined);
      this.publishMarket(stored.market);
    } catch (error) { send(ws, "order_rejected", { message: error instanceof Error ? error.message : String(error) }); }
  }

  private async cancelOrder(ws: WebSocket, session: Session, data: unknown): Promise<void> {
    try {
      this.requireAuth(session);
      const cancellation = data as SignedCancellation;
      if (cancellation.payload.owner !== session.owner || cancellation.payload.network !== this.options.network || cancellation.payload.program_id !== this.options.programId) throw new ProtocolError("cancellation does not match authenticated relayer context");
      verifySignedCancellation(cancellation);
      await this.verifyCancelTransaction(cancellation.payload);
      this.store.consumeNonce(cancellation.payload.owner, cancellation.payload.nonce, "CANCELLATION");
      const cancelled = this.engine.cancel(cancellation.payload.order_id, session.owner!);
      if (!cancelled) throw new ProtocolError("order is not open or does not belong to owner");
      send(ws, "order_cancelled", { order_id: cancellation.payload.order_id });
      const order = this.store.getOrder(cancellation.payload.order_id);
      if (order) this.publishMarket(order.market);
    } catch (error) { send(ws, "error", { code: "CANCEL_REJECTED", message: error instanceof Error ? error.message : String(error) }); }
  }

  private cancelAll(ws: WebSocket, session: Session, market?: string): void {
    try {
      this.requireAuth(session);
      const ids = this.engine.cancelAll(session.owner!, market);
      send(ws, "cancel_all_ack", { order_ids: ids });
      if (market) this.publishMarket(market); else for (const id of ids) { const order = this.store.getOrder(id); if (order) this.publishMarket(order.market); }
    } catch (error) { send(ws, "error", { code: "CANCEL_REJECTED", message: error instanceof Error ? error.message : String(error) }); }
  }

  private requireAuth(session: Session): asserts session is Session & { owner: string } { if (!session.owner || session.challenge) throw new ProtocolError("wallet authentication required"); }
  private sendMarket(ws: WebSocket, market: string): void { const entry = this.store.getMarket(market); if (entry) send(ws, "market_update", entry); }
  private publish(type: string, market: string, data: unknown, field: "marketSubscriptions" | "bookSubscriptions"): void { for (const [ws, session] of this.sessions) if (session[field].has(market)) send(ws, type, data); }
  private orderbook(market: string): { market: string; bids: Record<number, Array<{ price_bps: number; quantity: string }>>; asks: Record<number, Array<{ price_bps: number; quantity: string }>> } {
    const bids: Record<number, Array<{ price_bps: number; quantity: string }>> = {}, asks: Record<number, Array<{ price_bps: number; quantity: string }>> = {};
    for (const order of this.store.listOpenOrders(market)) {
      const side = order.side === "BUY" ? bids : asks;
      (side[order.outcome_index] ??= []).push({ price_bps: order.price_bps, quantity: (order.remaining_quantity - order.pending_quantity).toString() });
    }
    Object.values(bids).forEach(levels => levels.sort((a, b) => b.price_bps - a.price_bps));
    Object.values(asks).forEach(levels => levels.sort((a, b) => a.price_bps - b.price_bps));
    return { market, bids, asks };
  }
}
