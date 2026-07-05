import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { loadConfig } from "./config";
import { TxLineClient } from "./clients/txline-client";
import { AnchorClient } from "./clients/anchor-client";
import { activateApiToken } from "./clients/txline-auth";
import { ProofGatherer } from "./settlement/proof-gatherer";
import { Crank, CrankStatus } from "./settlement/crank";
import { WsServer, WsServerMessage } from "./api/ws-server";
import { MarketTrigger } from "./market/triggers";
import { FixtureWatcher } from "./market/fixture-watcher";
import { parseSoccerEvent } from "./market/event-parser";
import type { FixtureRecord } from "@swingkiddo/txodds-client";

function getRoundMessage(status: CrankStatus): WsServerMessage | null {
  const { fixtureId, roundId, txSig } = status;
  if (!txSig) return null;
  switch (status.action) {
    case "open_round":
      return {
        type: "round_opened",
        data: { fixtureId, roundId, marketType: "", lockSeconds: 0, deadlineSeconds: 0, expiresAt: 0 },
      };
    case "settle_onchain":
    case "settle_offchain":
      return { type: "round_settled", data: { fixtureId, roundId, outcome: "", txSig } };
    case "confirm_round":
      return { type: "round_confirmed", data: { fixtureId, roundId, txSig } };
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

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

  if (!config.txlineJwt && !config.txlineApiToken) {
    console.warn("No TxLINE credentials configured — attempting guest auth...");
  }

  const wsServer = new WsServer(config.wsPort);
  const txlineClient = new TxLineClient(config);
  const anchorClient = new AnchorClient(config);
  const proofGatherer = new ProofGatherer(txlineClient);
  const crank = new Crank(anchorClient, proofGatherer);
  const fixtureWatcher = new FixtureWatcher(txlineClient, config);
  const marketTrigger = new MarketTrigger();

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
      const connection = new Connection(config.solanaRpcUrl, "confirmed");
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
    } catch (err) {
      console.error("Failed to activate API token:", err instanceof Error ? err.message : err);
      console.warn("Continuing with limited guest access...");
    }
  }

  crank.on("status", (status: CrankStatus) => {
    wsServer.broadcast({ type: "tx_status", data: status });
    if (status.status === "confirmed") {
      const msg = getRoundMessage(status);
      if (msg) wsServer.broadcast(msg);
    }
  });

  crank.on("error", (err: Error) => {
    console.error("Crank error:", err.message);
  });

  marketTrigger.on("actions", (actions) => {
    crank.executeActions(actions).catch((e: Error) =>
      console.error("Trigger action error:", e.message),
    );
  });

  wsServer.start();
  console.log(`WS server listening on port ${config.wsPort}`);

  console.log(`Fetching fixtures for competition ${config.competitionId} (World Cup)...`);
  let fixtures: { FixtureId: number }[] = [];
  try {
    fixtures = (await txlineClient.getFixtures(config.competitionId)) as FixtureRecord[];
    console.log(`Loaded ${fixtures.length} fixtures.`);
  } catch (err) {
    console.error("Failed to fetch fixtures:", err instanceof Error ? err.message : err);
  }

  const activeFixtures = fixtures;
  for (const fixture of activeFixtures) {
    const fixtureId = fixture.FixtureId;
    let matchState: Awaited<ReturnType<typeof fixtureWatcher.loadFixture>>;
    try {
      matchState = await fixtureWatcher.loadFixture(fixtureId);
      console.log(
        `  Fixture ${fixtureId}: ${matchState.participants.home} vs ${matchState.participants.away} [${matchState.currentPeriod}]`,
      );
    } catch (err) {
      console.error(`  Failed to load fixture ${fixtureId}:`, err instanceof Error ? err.message : err);
      continue;
    }

    // Init Match PDA on-chain if not yet created
    const [matchPda] = AnchorClient.deriveMatchPda(fixtureId, config.kicktickProgramId);
    const rpcConn = new Connection(config.solanaRpcUrl, "confirmed");
    const matchOnChain = await rpcConn.getAccountInfo(matchPda);
    if (matchOnChain) {
      console.log(`  Match ${fixtureId}: already on-chain (${matchPda.toBase58()})`);
    } else {
      try {
        const { sig } = await anchorClient.initMatch(
          fixtureId, matchState.participants.home, matchState.participants.away,
        );
        console.log(`  Match ${fixtureId}: created on-chain (${matchPda.toBase58()}, tx: ${sig})`);
      } catch (err) {
        console.error(`  Match ${fixtureId}: initMatch failed — skipping`, err instanceof Error ? err.message : err);
        continue;
      }
    }

    try {
      marketTrigger.startCronWindows(fixtureId);
    } catch (err) {
      console.error(`  Failed to start cron for fixture ${fixtureId}:`, err instanceof Error ? err.message : err);
    }
  }

  const sseLoop = (async () => {
    console.log("Starting SSE scores stream...");
    for await (const event of txlineClient.streamScores()) {
      try {
        if (event.event === "heartbeat") continue;
        const rawData = JSON.parse(event.data);
        if (Object.keys(rawData).length === 1 && "Ts" in rawData) continue;

        const fixtureId = rawData.fixtureId;
        if (!fixtureId) continue;

        if (typeof rawData.competitionId === "number" && rawData.competitionId !== config.competitionId) continue;

        const soccerEvent = parseSoccerEvent(event);
        if (!soccerEvent) {
          console.log(`[SKIP] action=${rawData.action} sportId=${rawData.sportId} gameState=${rawData.gameState} fixtureId=${rawData.fixtureId}`);
          continue;
        }

        fixtureWatcher.processEvent(soccerEvent, fixtureId);
      } catch (err) {
        console.error("SSE event error:", err instanceof Error ? err.message : err);
      }
    }
  })();

  const timeoutTimer = setInterval(() => {
    const allFixtures = fixtureWatcher.getAllFixtures();
    for (const matchState of allFixtures) {
      const fixtureId = matchState.fixtureId;
      try {
        const timeoutActions = marketTrigger.checkTimeouts(fixtureId);
        if (timeoutActions.length > 0) {
          crank.executeActions(timeoutActions).catch((e: Error) =>
            console.error(`Timeout actions error [${fixtureId}]:`, e.message),
          );
        }
      } catch (err) {
        console.error(`Timeout check error [${fixtureId}]:`, err instanceof Error ? err.message : err);
      }
    }
  }, 5000);

  async function shutdown(): Promise<void> {
    console.log("\nShutting down...");
    clearInterval(timeoutTimer);
    for (const ms of fixtureWatcher.getAllFixtures()) {
      marketTrigger.stopCronWindows(ms.fixtureId);
    }
    wsServer.stop();
    console.log("Goodbye.");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await sseLoop;
  } catch (err) {
    console.error("SSE stream ended:", err instanceof Error ? err.message : err);
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
