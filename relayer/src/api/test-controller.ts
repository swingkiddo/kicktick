import { randomBytes } from "crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { WebSocket } from "ws";
import { WsServer, TestClientMessage } from "./ws-server";
import { AnchorClient, MarketType as AnchorMarketType } from "../clients/anchor-client";
import { ClobStore } from "../clob/store";
import { ClobLifecycle } from "../clob/lifecycle";
import { ClobWsApi } from "../clob/ws-api";
import { FixtureWatcher } from "../market/fixture-watcher";
import { MarketTrigger } from "../market/triggers";
import { MarketType, SoccerAction, StatusId } from "../market/event-parser";

interface Session { owner?: string; challenge?: string; }
interface Options {
  anchor: AnchorClient;
  store: ClobStore;
  lifecycle: ClobLifecycle;
  clob: ClobWsApi;
  watcher: FixtureWatcher;
  trigger: MarketTrigger;
}

const domain = "kicktick-test-admin";
const bytes = (owner: string, challenge: string) => Buffer.from(`${domain}\nowner=${owner}\nchallenge=${challenge}\n`, "utf8");
const send = (ws: WebSocket, type: string, data?: unknown) => ws.send(JSON.stringify(data === undefined ? { type } : { type, data }));

/** Dev-only control plane. It is deliberately separate from the public CLOB protocol. */
export class TestController {
  private readonly sessions = new Map<WebSocket, Session>();

  constructor(private readonly ws: WsServer, private readonly options: Options) {
    ws.on("connection", socket => this.sessions.set(socket, {}));
    ws.on("message", (socket, raw) => this.handle(socket, raw as TestClientMessage));
    ws.on("close", socket => this.sessions.delete(socket));
  }

  private handle(ws: WebSocket, message: TestClientMessage): void {
    if (!message.type.startsWith("test_")) return;
    try {
      switch (message.type) {
        case "test_auth_challenge": return this.challenge(ws, message.data.owner);
        case "test_auth_response": return this.authenticate(ws, message.data.owner, message.data.signature);
        case "test_create_match": this.requireAuth(ws); void this.createMatch(ws, message.data).catch(error => this.fail(ws, error)); return;
        case "test_create_market": this.requireAuth(ws); void this.createMarket(ws, message.data).catch(error => this.fail(ws, error)); return;
        case "test_emit_event": this.requireAuth(ws); this.emitEvent(ws, message.data); return;
        case "test_snapshot": this.requireAuth(ws); this.snapshot(ws); return;
        case "test_reset": this.requireAuth(ws); this.reset(ws); return;
      }
    } catch (error) {
      send(ws, "test_error", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private challenge(ws: WebSocket, owner: string): void {
    if (owner !== this.options.anchor.walletPublicKey.toBase58()) throw new Error("test control requires the relayer/admin wallet");
    const challenge = randomBytes(32).toString("base64url");
    this.sessions.get(ws)!.owner = owner;
    this.sessions.get(ws)!.challenge = challenge;
    send(ws, "test_auth_challenge", { owner, challenge, expires_at: Math.floor(Date.now() / 1000) + 60 });
  }

  private authenticate(ws: WebSocket, owner: string, signatureText: string): void {
    const session = this.sessions.get(ws);
    if (!session?.challenge || session.owner !== owner) throw new Error("request a test challenge first");
    const signature = Buffer.from(signatureText, "base64");
    if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(bytes(owner, session.challenge), signature, new PublicKey(owner).toBytes())) {
      throw new Error("invalid test admin signature");
    }
    session.challenge = undefined;
    send(ws, "test_authenticated", { owner });
  }

  private requireAuth(ws: WebSocket): void {
    const session = this.sessions.get(ws);
    if (!session?.owner || session.challenge) throw new Error("test admin authentication required");
  }

  private async createMatch(ws: WebSocket, data: { fixtureId: number; homeTeam: string; awayTeam: string }): Promise<void> {
    const result = await this.options.anchor.initMatch(data.fixtureId, data.homeTeam, data.awayTeam);
    const state = this.options.watcher.registerSyntheticFixture(data.fixtureId, data.homeTeam, data.awayTeam);
    this.options.trigger.startCronWindows(data.fixtureId);
    this.broadcastMatch(state);
    send(ws, "test_ack", { command: "test_create_match", fixtureId: data.fixtureId, txSig: result.sig, matchPda: result.matchPda.toBase58() });
  }

  private async createMarket(ws: WebSocket, data: { fixtureId: number; marketType: string; marketSeq: number; deadlineSeconds: number }): Promise<void> {
    if (!Object.values(MarketType).includes(data.marketType as MarketType)) throw new Error(`unknown market type ${data.marketType}`);
    const marketType = data.marketType as AnchorMarketType;
    const txSig = await this.options.anchor.initMarket(data.fixtureId, marketType, data.marketSeq, data.deadlineSeconds);
    const [market] = AnchorClient.deriveMarketPda(BigInt(data.fixtureId), AnchorClient.marketTypeIndex(marketType), BigInt(data.marketSeq), this.options.anchor.programId);
    const expiresAt = Math.floor(Date.now() / 1000) + data.deadlineSeconds;
    const outcomeCount = [MarketType.NextGoalSide, MarketType.NextCorner, MarketType.NextYellowCard, MarketType.PenaltyShootoutShot].includes(data.marketType as MarketType) ? 3 : 2;
    this.options.lifecycle.open({ market: market.toBase58(), fixture_id: String(data.fixtureId), market_type: data.marketType, market_seq: String(data.marketSeq), outcome_count: outcomeCount, expires_at: expiresAt, state: "OPEN" });
    this.options.trigger.registerSyntheticMarket(data.fixtureId, data.marketSeq, data.marketType as MarketType, expiresAt);
    this.options.clob.publishMarket(market.toBase58());
    this.ws.broadcast({ type: "market_opened", data: { fixtureId: data.fixtureId, marketSeq: data.marketSeq, marketType: data.marketType, lockSeconds: 0, deadlineSeconds: data.deadlineSeconds, expiresAt: expiresAt * 1000 } });
    send(ws, "test_ack", { command: "test_create_market", fixtureId: data.fixtureId, marketSeq: data.marketSeq, market: market.toBase58(), txSig });
  }

  private emitEvent(ws: WebSocket, data: { fixtureId: number; action: string; participant?: number; statusId?: number; outcome?: string }): void {
    const state = this.options.watcher.getFixtureState(data.fixtureId);
    if (!state) throw new Error(`unknown test fixture ${data.fixtureId}`);
    const action = data.action as SoccerAction;
    const event: any = { action, participant: data.participant, seq: Date.now() };
    if (action === SoccerAction.Status) event.statusId = data.statusId ?? StatusId.FirstHalf;
    if (action === SoccerAction.Goal) event.goalType = "Other";
    if (action === SoccerAction.PenaltyOutcome) event.outcome = data.outcome ?? "Scored";
    if (action === SoccerAction.Var) event.varType = "Other";
    if (action === SoccerAction.VarEnd) event.outcome = data.outcome ?? "Stands";
    const next = this.options.watcher.processEvent(event, data.fixtureId);
    if (!next) throw new Error(`failed to process event for fixture ${data.fixtureId}`);
    this.broadcastMatch(next);
    this.ws.broadcast({ type: "football_event", data: { action: data.action, fixtureId: data.fixtureId, participant: data.participant, description: `test ${data.action} on fixture ${data.fixtureId}` } });
    this.options.trigger.processEvent(event, data.fixtureId, next);
    send(ws, "test_ack", { command: "test_emit_event", fixtureId: data.fixtureId, action: data.action });
  }

  private snapshot(ws: WebSocket): void {
    send(ws, "test_snapshot", { matches: this.options.watcher.getAllFixtures().map(state => ({ fixtureId: state.fixtureId, status: state.status, homeScore: state.homeScore, awayScore: state.awayScore })), markets: this.options.store.listMarkets() });
  }

  private reset(ws: WebSocket): void { this.options.store.clearForTest(); send(ws, "test_ack", { command: "test_reset" }); }

  private fail(ws: WebSocket, error: unknown): void { send(ws, "test_error", { message: error instanceof Error ? error.message : String(error) }); }

  private broadcastMatch(state: ReturnType<FixtureWatcher["getFixtureState"]> & object): void {
    this.ws.broadcast({ type: "match_state", data: { fixtureId: state.fixtureId, status: String(state.status), homeScore: state.homeScore, awayScore: state.awayScore, currentPeriod: state.currentPeriod, matchClockMs: state.matchClockMs } });
  }
}
