import { randomBytes } from "crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { WebSocket } from "ws";
import { WsServer, TestClientMessage } from "./ws-server";
import { AnchorClient, AnchorClientError } from "../clients/anchor-client";
import { MarketType } from "../domain/markets";
import { SoccerAction, StatusId } from "../domain/football/types";
import { ClobStore } from "../clob/store";
import { ClobLifecycle } from "../clob/lifecycle";
import { ClobWsApi } from "../clob/ws-api";
import { FixtureWatcher } from "../market/fixture-watcher";
import { MarketTrigger } from "../market/triggers";

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
const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const send = (ws: WebSocket, type: string, data?: unknown) => ws.send(serialize(data === undefined ? { type } : { type, data }));
const testAuthRequired = process.env.TEST_AUTH_REQUIRED === "true";

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
    const data = (message as any).data;
    console.log(`[TEST_CTRL] received ${message.type}`, message.type === "test_auth_response" ? { owner: data.owner, signatureLength: Buffer.from(data.signature, "base64").length } : data ?? {});
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
    const expectedOwner = this.options.anchor.walletPublicKey.toBase58();
    console.log(`[TEST_AUTH] challenge requested owner=${owner} expected=${expectedOwner}`);
    if (owner !== expectedOwner) throw new Error("test control requires the relayer/admin wallet");
    const challenge = randomBytes(32).toString("base64url");
    this.sessions.get(ws)!.owner = owner;
    this.sessions.get(ws)!.challenge = challenge;
    console.log(`[TEST_AUTH] challenge issued owner=${owner}`);
    send(ws, "test_auth_challenge", { owner, challenge, expires_at: Math.floor(Date.now() / 1000) + 60 });
  }

  private authenticate(ws: WebSocket, owner: string, signatureText: string): void {
    const session = this.sessions.get(ws);
    console.log(`[TEST_AUTH] response received owner=${owner} signatureLength=${Buffer.from(signatureText, "base64").length} hasSession=${Boolean(session)} hasChallenge=${Boolean(session?.challenge)}`);
    if (!session?.challenge || session.owner !== owner) throw new Error("request a test challenge first");
    const signature = Buffer.from(signatureText, "base64");
    if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(bytes(owner, session.challenge), signature, new PublicKey(owner).toBytes())) {
      console.error(`[TEST_AUTH] invalid signature owner=${owner}`);
      throw new Error("invalid test admin signature");
    }
    session.challenge = undefined;
    console.log(`[TEST_AUTH] authenticated owner=${owner}`);
    send(ws, "test_authenticated", { owner });
  }

  private requireAuth(ws: WebSocket): void {
    if (!testAuthRequired) return;
    const session = this.sessions.get(ws);
    if (!session?.owner || session.challenge) throw new Error("test admin authentication required");
  }

  private async createMatch(ws: WebSocket, data: { fixtureId: number; homeTeam: string; awayTeam: string }): Promise<void> {
    const startedAt = Date.now();
    const [matchPda] = AnchorClient.deriveMatchPda(data.fixtureId, this.options.anchor.programId);
    console.log(`[TEST_CTRL] create match start fixture=${data.fixtureId} matchPda=${matchPda.toBase58()} teams="${data.homeTeam}" vs "${data.awayTeam}"`);
    console.log(`[TEST_CTRL] create match invoking Anchor initMatch fixture=${data.fixtureId}`);
    const result = await this.options.anchor.initMatch(data.fixtureId, data.homeTeam, data.awayTeam);
    console.log(`[TEST_CTRL] create match transaction confirmed fixture=${data.fixtureId} tx=${result.sig} elapsedMs=${Date.now() - startedAt}`);
    const onChainMatch = await this.options.anchor.fetchMatchRecord(result.matchPda);
    this.options.store.upsertMatch({
      fixture_id: String(onChainMatch.fixtureId),
      match: onChainMatch.matchPda.toBase58(),
      status: onChainMatch.status,
      home_team: onChainMatch.homeTeam,
      away_team: onChainMatch.awayTeam,
      competition_id: onChainMatch.competitionId,
      created_at: onChainMatch.createdAt * 1000,
    });
    console.log(`[TEST_CTRL] match persisted fixture=${data.fixtureId} pda=${result.matchPda.toBase58()}`);
    const state = this.options.watcher.registerSyntheticFixture(data.fixtureId, data.homeTeam, data.awayTeam);
    console.log(`[TEST_CTRL] synthetic fixture registered fixture=${data.fixtureId}`);
    this.options.trigger.startCronWindows(data.fixtureId);
    this.broadcastMatch(state);
    send(ws, "test_ack", { command: "test_create_match", fixtureId: data.fixtureId, txSig: result.sig, matchPda: result.matchPda.toBase58() });
    console.log(`[TEST_CTRL] create match ack sent fixture=${data.fixtureId}`);
  }

  private async createMarket(ws: WebSocket, data: { fixtureId: number; marketType: string; marketSeq: number; deadlineSeconds: number }): Promise<void> {
    if (!Object.values(MarketType).includes(data.marketType as MarketType)) throw new Error(`unknown market type ${data.marketType}`);
    const marketType = data.marketType as MarketType;
    const [matchPda] = AnchorClient.deriveMatchPda(data.fixtureId, this.options.anchor.programId);
    await this.options.anchor.fetchMatchRecord(matchPda);
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
    this.ws.broadcastToMatch(data.fixtureId, { type: "football_event", data: { action: data.action, fixtureId: data.fixtureId, participant: data.participant, description: `test ${data.action} on fixture ${data.fixtureId}` } });
    this.options.trigger.processEvent(event, data.fixtureId, next);
    send(ws, "test_ack", { command: "test_emit_event", fixtureId: data.fixtureId, action: data.action });
  }

  private snapshot(ws: WebSocket): void {
    send(ws, "test_snapshot", { matches: this.options.watcher.getAllFixtures().map(state => ({ fixtureId: state.fixtureId, status: state.status, homeScore: state.homeScore, awayScore: state.awayScore })), markets: this.options.store.listMarkets() });
  }

  private reset(ws: WebSocket): void { this.options.store.clearForTest(); this.options.watcher.clear(); this.options.trigger.reset(); send(ws, "test_ack", { command: "test_reset" }); }

  private fail(ws: WebSocket, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TEST_CTRL] command failed', message, error instanceof Error ? error.stack : '');
    if (error instanceof AnchorClientError) console.error('[TEST_CTRL] on-chain logs', error.logs ?? []);
    send(ws, "test_error", { message });
  }

  private broadcastMatch(state: ReturnType<FixtureWatcher["getFixtureState"]> & object): void {
    this.ws.broadcastToMatch(state.fixtureId, { type: "match_state", data: { fixtureId: state.fixtureId, status: String(state.status), homeScore: state.homeScore, awayScore: state.awayScore, currentPeriod: state.currentPeriod, matchClockMs: state.matchClockMs } });
  }
}
