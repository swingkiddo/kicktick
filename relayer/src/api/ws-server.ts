import { EventEmitter } from "events";
import { WebSocket, WebSocketServer } from "ws";

const jsonReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? value.toString() : value;

const serialize = (value: unknown): string => JSON.stringify(value, jsonReplacer);

export type WsServerMessage =
  | { type: "match_state"; data: { fixtureId: number; status: string; homeScore: number; awayScore: number; currentPeriod: string; matchClockMs: number } }
  | { type: "market_opened"; data: { fixtureId: number; marketSeq: number; marketType: string; lockSeconds: number; deadlineSeconds: number; expiresAt: number } }
  | { type: "market_resolved"; data: { fixtureId: number; marketSeq: number; outcome: string; txSig?: string } }
  | { type: "market_confirmed"; data: { fixtureId: number; marketSeq: number; txSig?: string } }
  | { type: "market_cancelled"; data: { fixtureId: number; marketSeq: number } }
  | { type: "football_event"; data: { action: string; fixtureId: number; participant?: number; description: string } }
  | { type: "tx_status"; data: { fixtureId: number; marketSeq: number; status: string; txSig?: string; error?: string } }
  | { type: "system_status"; data: { clientCount: number; uptime: number; activeFixtureCount: number; solBalance: number } }
  | { type: "error_log"; data: { message: string; timestamp: number; fixtureId?: number; marketSeq?: number } }
  | { type: "error"; data: { message: string } };

export type WsClientMessage =
  | { type: "subscribe_match"; data: { fixtureId: number } }
  | { type: "unsubscribe_match"; data: { fixtureId: number } }
  | { type: "subscribe_all" }
  | { type: "ping" }
  | { type: "auth_challenge"; data: { owner: string } }
  | { type: "auth_response"; data: { owner: string; signature: string } }
  | { type: "subscribe_market"; data: { market: string } }
  | { type: "unsubscribe_market"; data: { market: string } }
  | { type: "subscribe_orderbook"; data: { market: string } }
  | { type: "submit_order"; data: unknown }
  | { type: "cancel_order"; data: unknown }
  | { type: "cancel_all"; data?: { market?: string } };

export type TestClientMessage =
  | { type: "test_auth_challenge"; data: { owner: string } }
  | { type: "test_auth_response"; data: { owner: string; signature: string } }
  | { type: "test_create_match"; data: { fixtureId: number; homeTeam: string; awayTeam: string } }
  | { type: "test_create_market"; data: { fixtureId: number; marketType: string; marketSeq: number; deadlineSeconds: number } }
  | { type: "test_emit_event"; data: { fixtureId: number; action: string; participant?: number; statusId?: number; outcome?: string } }
  | { type: "test_snapshot" }
  | { type: "test_reset" };

interface ClientState {
  isAlive: boolean;
  subscribedFixtures: Set<number>;
}

export class WsServer extends EventEmitter {
  private wss!: WebSocketServer;
  private readonly port: number;
  private readonly subscriptions: Map<number, Set<WebSocket>> = new Map();
  private readonly clients: Map<WebSocket, ClientState> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(port: number) {
    super();
    this.port = port;
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.port, maxPayload: 16 * 1024 });

    this.wss.on("connection", (ws: WebSocket) => {
      const state: ClientState = { isAlive: true, subscribedFixtures: new Set() };
      this.clients.set(ws, state);

      ws.send(serialize({ type: "welcome", data: { version: "0.1.0" } }));
      this.emit("connection", ws);

      ws.on("message", (data) => {
        let msg: WsClientMessage;
        try {
          msg = JSON.parse(data.toString()) as WsClientMessage;
        } catch {
          console.error("WS malformed message:", data.toString().substring(0, 120));
          return;
        }

        this.emit("message", ws, msg);

        switch (msg.type) {
          case "ping":
            ws.send(serialize({ type: "pong" }));
            break;

          case "subscribe_match": {
            const { fixtureId } = msg.data;
            if (!this.subscriptions.has(fixtureId)) {
              this.subscriptions.set(fixtureId, new Set());
            }
            this.subscriptions.get(fixtureId)!.add(ws);
            state.subscribedFixtures.add(fixtureId);
            this.emit("subscribe", fixtureId);
            break;
          }

          case "unsubscribe_match": {
            const { fixtureId } = msg.data;
            this.subscriptions.get(fixtureId)?.delete(ws);
            state.subscribedFixtures.delete(fixtureId);
            this.emit("unsubscribe", fixtureId);
            break;
          }

          case "subscribe_all": {
            for (const fixtureId of this.subscriptions.keys()) {
              this.subscriptions.get(fixtureId)!.add(ws);
              state.subscribedFixtures.add(fixtureId);
            }
            this.emit("subscribe_all", ws);
            break;
          }
        }
      });

      ws.on("pong", () => {
        state.isAlive = true;
      });

      ws.on("close", () => {
        this.cleanupClient(ws);
      });

      ws.on("error", (err) => {
        console.error("WS client error:", err.message);
        this.cleanupClient(ws);
      });
    });

    this.wss.on("error", (err) => {
      console.error("WS server error:", err.message);
    });

    this.heartbeatTimer = setInterval(() => {
      for (const [ws, state] of this.clients) {
        if (!state.isAlive) {
          ws.terminate();
          this.cleanupClient(ws);
          continue;
        }
        state.isAlive = false;
        ws.ping();

        setTimeout(() => {
          const s = this.clients.get(ws);
          if (s && !s.isAlive) {
            ws.terminate();
            this.cleanupClient(ws);
          }
        }, 10_000);
      }
    }, 30_000);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const ws of this.clients.keys()) {
      ws.terminate();
    }
    this.subscriptions.clear();
    this.clients.clear();
    this.wss.close();
  }

  broadcast(msg: WsServerMessage): void {
    const payload = serialize(msg);
    for (const ws of this.wss.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  send(ws: WebSocket, type: string, data?: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(serialize(data === undefined ? { type } : { type, data }));
  }

  broadcastToMatch(fixtureId: number, msg: WsServerMessage): void {
    const payload = serialize(msg);
    const subs = this.subscriptions.get(fixtureId);
    if (!subs) return;
    for (const ws of subs) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  get clientCount(): number {
    return this.wss?.clients?.size ?? 0;
  }

  private cleanupClient(ws: WebSocket): void {
    const state = this.clients.get(ws);
    if (state) {
      for (const fixtureId of state.subscribedFixtures) {
        this.subscriptions.get(fixtureId)?.delete(ws);
      }
    }
    this.clients.delete(ws);
    this.emit("close", ws);
  }
}
