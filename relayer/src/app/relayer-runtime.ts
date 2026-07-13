import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import path from "path";
import { loadConfig } from "../config";
import { AnchorClient } from "../clients/anchor-client";
import { activateApiToken } from "../clients/txline-auth";
import { solanaRpcFetch } from "../clients/solana-rpc";
import { ProofGatherer } from "../settlement/proof-gatherer";
import { Crank, CrankStatus } from "../settlement/crank";
import type { WsServerMessage } from "../api/ws-server";
import { MarketTrigger, type TriggerAction } from "../market/triggers";
import { FixtureWatcher } from "../market/fixture-watcher";
import type { MatchState } from "../domain/football/types";
import { parseFootballEvent } from "../domain/football/event-parser";
import {
  normalizeScoreEvent,
  parseRawScoreEventPayload,
} from "../infrastructure/txline/score-mapper";
import { SseLogger } from "../market/sse-logger";
import { ClobRecovery } from "../clob/recovery";
import { MarketActionExecutor } from "../market/action-executor";
import { TestController } from "../api/test-controller";
import { bootstrapInfrastructure } from "./bootstrap";
import { RelayerScheduler } from "./scheduler";
import { registerShutdown } from "./shutdown";
import { FixtureRuntime } from "./fixture-runtime";

function actionSummary(actions: TriggerAction[]): string {
  return actions.map(a => {
    const extra = "marketType" in a ? ` ${(a as any).marketType}` : "";
    return `${a.type}[${a.fixtureId}:${a.marketSeq}${extra}]`;
  }).join(", ");
}

function getMarketMessage(status: CrankStatus): WsServerMessage | null {
  const { fixtureId, marketSeq, txSig } = status;
  if (!txSig) return null;
  switch (status.action) {
    case "open_market":
      return {
        type: "market_opened",
        data: { fixtureId, marketSeq, marketType: "", lockSeconds: 0, deadlineSeconds: 0, expiresAt: 0 },
      };
    case "settle_onchain":
    case "settle_offchain":
      return { type: "market_resolved", data: { fixtureId, marketSeq, outcome: "", txSig } };
    case "confirm_market":
      return { type: "market_confirmed", data: { fixtureId, marketSeq, txSig } };
    default:
      return null;
  }
}

export async function runRelayer(): Promise<void> {
  const config = loadConfig();
  // MVP trading mode: keep the WebSocket/CLOB control plane available without
  // waiting for TxLINE, SSE, fixture reconciliation, or lifecycle recovery.
  // const clobOnlyMode = process.env.CLOB_ONLY_MODE === "false"
  //   ? false
  //   : config.testMode || process.env.CLOB_ONLY_MODE === "true";
  const clobOnlyMode = false;
  const infrastructure = bootstrapInfrastructure(config);
  const { rpcConnection, wsServer, txlineClient, anchorClient, clobStore, matchingEngine, fillSettlement, orderCleanup, clobLifecycle, clobWsApi } = infrastructure;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║       KickTick Relayer v0.1.0            ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`  Solana RPC:      ${config.solanaRpcUrl}`);
  console.log(`  Keypair:         ${config.solanaPrivateKey ? "loaded from env" : "missing — check SOLANA_PRIVATE_KEY"}`);
  console.log(`  KickTick PID:    ${config.kicktickProgramId.toBase58()}`);
  console.log(`  TxOracle PID:    ${config.txoracleProgramId.toBase58()}`);
  console.log(`  WS Port:         ${config.wsPort}`);
  console.log(`  TxLINE Host:     ${config.txlineApiHost}`);
  console.log(`  TxLINE JWT:      ${config.txlineJwt ? "set" : "missing"}`);
  console.log(`  TxLINE Token:    ${config.txlineApiToken ? "set" : "missing"}`);
  console.log(`  CLOB database:   ${config.clobDbPath}`);
  console.log(`  CLOB-only mode:  ${clobOnlyMode ? "enabled" : "disabled"}`);

  if (!config.txlineJwt && !config.txlineApiToken) {
    console.warn("No TxLINE credentials configured — attempting guest auth...");
  }

  if (!clobOnlyMode) {
    try {
      const recovery = await new ClobRecovery(clobStore, matchingEngine).recover(anchorClient);
      console.log(`  CLOB recovery: ${recovery.restored_orders} books, ${recovery.confirmed_fills.length} confirmed, ${recovery.retry_fills.length} pending`);
      for (const fillId of recovery.retry_fills) {
        const fill = clobStore.getFill(fillId);
        if (fill) {
          fillSettlement.submit(fill).catch((error) => {
            console.warn(`CLOB fill retry failed for ${fillId}:`, error instanceof Error ? error.message : error);
          });
        }
      }
    } catch (error) {
      console.warn(`  CLOB recovery deferred: ${error instanceof Error ? error.message : error}`);
    }
    try {
      orderCleanup.enqueueExpired();
      await orderCleanup.processPending();
      for (const market of clobStore.listMarkets(["LOCKING"])) {
        const chainState = await anchorClient.getMarketState(market.market);
        if (chainState !== "OPEN") clobLifecycle.reconcile(market.market, chainState);
        await clobLifecycle.lockAndCleanup(market.market);
      }
    } catch (error) {
      console.warn(`  Order cleanup recovery deferred: ${error instanceof Error ? error.message : error}`);
    }
  } else {
    console.log("  CLOB recovery/cleanup: skipped in CLOB-only mode");
  }
  const proofGatherer = new ProofGatherer(txlineClient);
  const crank = new Crank(anchorClient, proofGatherer);
  const marketActions = new MarketActionExecutor(
    clobStore,
    clobLifecycle,
    fillSettlement,
    crank,
    config.kicktickProgramId,
    { onMarketChanged: (market) => clobWsApi.publishMarket(market) },
  );
  if (!clobOnlyMode) {
    try {
      await marketActions.recover(anchorClient);
    } catch (error) {
      console.warn(`  Market lifecycle recovery deferred: ${error instanceof Error ? error.message : error}`);
    }
  } else {
    console.log("  Market lifecycle recovery: skipped in CLOB-only mode");
  }
  const fixtureWatcher = new FixtureWatcher(txlineClient, config);
  const marketTrigger = new MarketTrigger();
  const fixtureRuntime = new FixtureRuntime({ config, rpcConnection, txlineClient, anchorClient, clobStore, fixtureWatcher, marketTrigger });
  if (!clobOnlyMode) await fixtureRuntime.reconcileOnChainMatches();
  const restoredPdas = new Map<number, string>();
  for (const market of clobStore.listMarkets()) {
    const fixtureId = Number(market.fixture_id);
    restoredPdas.set(fixtureId, AnchorClient.deriveMatchPda(fixtureId, config.kicktickProgramId)[0].toBase58());
  }
  const restoredCursors = new Map<number, number>();
  for (const fixture of clobStore.listMarkets().map(m => Number(m.fixture_id))) {
    const cursor = clobStore.getFixtureCursor(String(fixture));
    if (cursor) restoredCursors.set(fixture, cursor.last_seq);
  }
  marketTrigger.restoreMarkets(clobStore.listMarkets(), restoredPdas, restoredCursors);
  const sseLogger = new SseLogger(
    path.resolve(__dirname, `../../logs/sse-${new Date().toISOString().replace(/[:.]/g, "-")}.log`),
  );
  console.log(`  SSE log file:   ${sseLogger.path}`);

  if (!clobOnlyMode) {
    let jwt = config.txlineJwt;
    if (!jwt) {
      console.log("Authenticating with TxLINE...");
      jwt = await txlineClient.authenticate();
      txlineClient.setJwt(jwt);
      console.log("TxLINE JWT obtained.");
    }

    if (!config.txlineApiToken) {
    console.log("Activating API token (World Cup free tier)...");
    const keypair = Keypair.fromSecretKey(Buffer.from(config.solanaPrivateKey, "hex"));
    try {
      const connection = new Connection(config.solanaRpcUrl, {
        commitment: "confirmed",
        fetch: solanaRpcFetch,
        disableRetryOnRateLimit: true,
      });
      await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        config.txlMint,
        keypair.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      console.log("TxL token account ready.");

      const solBalance = await connection.getBalance(keypair.publicKey);
      console.log(`  SOL balance: ${solBalance / LAMPORTS_PER_SOL} SOL`);

      const activation = await activateApiToken(jwt, keypair, {
        apiHost: config.txlineApiHost,
        serviceLevelId: 1,
        solanaRpcUrl: config.solanaRpcUrl,
      });
      const { txSig, apiToken } = activation;
      console.log(`  Subscribe txSig: ${txSig}`);
      const txStatus = await connection.getSignatureStatus(txSig);
      console.log(`  Tx confirmed: ${txStatus?.value?.confirmationStatus ?? "no"}`);

      txlineClient.setApiToken(apiToken);
      console.log("API token set, testing...");
      try {
        const testFixtures = await txlineClient.getFixtures(config.competitionId);
        console.log(`  API token OK: ${testFixtures.length} fixtures returned`);
      } catch (e) {
        console.warn(`  API token rejected: ${e instanceof Error ? e.message : e}`);
        throw e;
      }

      console.log("  API token activated for this process; provide TXLINE_API_TOKEN through the runtime environment to reuse it.");
    } catch (err) {
      console.error("Failed to activate API token:", err instanceof Error ? err.message : err);
      console.warn("Continuing with limited guest access...");
    }
    }
  } else {
    console.log("  TxLINE auth/API token: skipped in CLOB-only mode");
  }

  crank.on("status", (status: CrankStatus) => {
    wsServer.broadcast({ type: "tx_status", data: status });
    if (status.status === "confirmed") {
      const msg = getMarketMessage(status);
      if (msg) wsServer.broadcastToMatch(status.fixtureId, msg);
    }
  });

  crank.on("error", (err: Error) => {
    console.error(`Crank error: ${err.message}`);
    wsServer.broadcast({
      type: "error_log",
      data: {
        message: err.message,
        timestamp: Date.now(),
      },
    });
  });

  marketTrigger.on("actions", (actions) => {
    const summary = actionSummary(actions);
    console.log(`[ACTIONS] ${summary}`);
    marketActions.enqueue(actions).catch((e: Error) =>
      console.error(`Trigger action error: ${e.message} (actions: ${summary})`),
    );
  });

  console.log("test mode:", config.testMode)
  if (config.testMode) {
    new TestController(wsServer, {
      anchor: anchorClient,
      store: clobStore,
      lifecycle: clobLifecycle,
      clob: clobWsApi,
      watcher: fixtureWatcher,
      trigger: marketTrigger,
    });
    console.log("  Dev test control plane: enabled");
  }

  wsServer.start();
  console.log(`WS server listening on port ${config.wsPort}`);

  wsServer.on("subscribe_all", (ws) => {
    const allFixtures = fixtureWatcher.getAllFixtures();
      for (const matchState of allFixtures) {
      ws.send(JSON.stringify({
        type: "match_state",
        data: {
          fixtureId: matchState.fixtureId,
          status: String(matchState.status),
          homeScore: matchState.homeScore,
          awayScore: matchState.awayScore,
          currentPeriod: matchState.currentPeriod,
          matchClockMs: matchState.matchClockMs,
        },
      }));
    }
    console.log(`[WS] Sent ${allFixtures.length} match states to new subscriber`);
  });

  if (!clobOnlyMode) await fixtureRuntime.loadCompetitionFixtures();
  fixtureRuntime.restorePersistedFixtures();

  function broadcastMatchState(matchState: MatchState): void {
    wsServer.broadcastToMatch(matchState.fixtureId, {
      type: "match_state",
      data: {
        fixtureId: matchState.fixtureId,
        status: String(matchState.status),
        homeScore: matchState.homeScore,
        awayScore: matchState.awayScore,
        currentPeriod: matchState.currentPeriod,
        matchClockMs: matchState.matchClockMs,
      },
    });
  }

  async function replayScoresAfterReconnect(): Promise<void> {
    const fixturesToReplay = fixtureWatcher.getAllFixtures();
    await Promise.all(fixturesToReplay.map(async (state) => {
      try {
        const updates = await txlineClient.getScoresUpdates(state.fixtureId);
        for (const update of updates
          .filter((candidate) => Number.isSafeInteger(candidate.seq) && candidate.seq > 0)
          .sort((a, b) => a.seq - b.seq)) {
          if (!clobStore.advanceFixtureCursor(String(state.fixtureId), update.seq)) continue;
          const reconciled = fixtureWatcher.applyScoreUpdate(update);
          if (!reconciled) continue;
          broadcastMatchState(reconciled.state);
          // Replay reconstructs the current score state only. Historical
          // events must not create and submit a second lifecycle of markets.
        }
      } catch (error) {
        console.warn(`Score replay failed for fixture ${state.fixtureId}:`, error instanceof Error ? error.message : error);
      }
    }));
  }

  const sseLoop = clobOnlyMode ? Promise.resolve() : (async () => {
    console.log("Starting SSE scores stream...");
    let lastConnectionId = 0;
    for await (const event of txlineClient.streamScores()) {
      try {
        if (event.connectionId !== lastConnectionId) {
          lastConnectionId = event.connectionId;
          await replayScoresAfterReconnect();
        }
        if (event.event === "heartbeat") continue;
        sseLogger.write(event.data);
        const rawParsed = parseRawScoreEventPayload(JSON.parse(event.data));
        if (Object.keys(rawParsed).length === 1 && "Ts" in rawParsed) continue;

        const rawData = normalizeScoreEvent(rawParsed, {
          sourceMessageId: event.id ?? undefined,
        });
        if (!rawData.fixtureId) continue;

        if (typeof rawParsed.CompetitionId === "number" && rawParsed.CompetitionId !== config.competitionId) continue;

        // Id identifies the upstream event; Seq is the only proof/cursor
        // sequence and must never fall back to Id.
        const sequence = rawData.seq;
        if (sequence > 0 && !clobStore.advanceFixtureCursor(String(rawData.fixtureId), sequence)) {
          console.log(`[DUPLICATE] fixture=${rawData.fixtureId} seq=${sequence}`);
          continue;
        }

        const parsedEvent = parseFootballEvent(rawData);
        if (parsedEvent.kind === "unsupported") {
          console.log(`[SKIP] action=${rawData.action} sportId=${rawParsed.SportId} gameState=${rawData.gameState} fixtureId=${rawData.fixtureId}`);
          continue;
        }
        const soccerEvent = parsedEvent.event;

        const clockStr = rawData.clock ? `${rawData.clock.seconds}s` : "";
        console.log(`[EVENT] fixture=${rawData.fixtureId} action=${rawData.action} gameState=${rawData.gameState} seq=${rawData.seq} participant=${rawData.participant ?? "-"} clock=${clockStr}`);

        const matchState = fixtureWatcher.processEvent(soccerEvent, rawData.fixtureId);
        if (matchState) {
          broadcastMatchState(matchState);

          wsServer.broadcastToMatch(rawData.fixtureId, {
            type: "football_event",
            data: {
              action: soccerEvent.action,
              fixtureId: rawData.fixtureId,
              participant: soccerEvent.participant,
              description: `${soccerEvent.action} on fixture ${rawData.fixtureId}`,
            },
          });

          marketTrigger.processEvent(soccerEvent, rawData.fixtureId, matchState);
        }
      } catch (err) {
        console.error("SSE event error:", err instanceof Error ? err.message : err);
      }
    }
  })();

  const scheduler = new RelayerScheduler({ fixtureWatcher, marketTrigger, marketActions, anchorClient, orderCleanup, rpcConnection, wsServer, summarize: actionSummary });
  if (!clobOnlyMode) scheduler.start();
  registerShutdown({
    stopSchedulers: () => scheduler.stop(),
    stopCronWindows: () => fixtureWatcher.getAllFixtures().forEach(state => marketTrigger.stopCronWindows(state.fixtureId)),
    stopUpstream: () => txlineClient.stop(),
    drainWork: async () => { await Promise.all([marketActions.drain(), fillSettlement.drainAll()]); },
    closeTransport: () => wsServer.stop(),
    closeLogger: () => sseLogger.close(),
    closeStorage: () => clobStore.close(),
  });

  try {
    await sseLoop;
  } catch (err) {
    console.error("SSE stream ended:", err instanceof Error ? err.message : err);
  }
}
