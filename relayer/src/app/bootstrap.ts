import { Connection } from "@solana/web3.js";
import type { Config } from "../config";
import { WsServer } from "../api/ws-server";
import { TxLineClient } from "../clients/txline-client";
import { AnchorClient } from "../clients/anchor-client";
import { solanaRpcFetch } from "../clients/solana-rpc";
import { ClobStore } from "../clob/store";
import { MatchingEngine } from "../clob/matching-engine";
import { FillSettlementQueue } from "../clob/settlement";
import { OrderCleanupProcessor } from "../clob/cleanup";
import { ClobLifecycle } from "../clob/lifecycle";
import { ClobWsApi } from "../clob/ws-api";

export interface RelayerInfrastructure {
  rpcConnection: Connection;
  wsServer: WsServer;
  txlineClient: TxLineClient;
  anchorClient: AnchorClient;
  clobStore: ClobStore;
  matchingEngine: MatchingEngine;
  fillSettlement: FillSettlementQueue;
  orderCleanup: OrderCleanupProcessor;
  clobLifecycle: ClobLifecycle;
  clobWsApi: ClobWsApi;
}

/** Constructs infrastructure dependencies without starting external work. */
export function bootstrapInfrastructure(config: Config): RelayerInfrastructure {
  const rpcConnection = new Connection(config.solanaRpcUrl, {
    commitment: "confirmed",
    fetch: solanaRpcFetch,
    disableRetryOnRateLimit: true,
  });
  const wsServer = new WsServer(config.wsPort);
  const txlineClient = new TxLineClient(config);
  const anchorClient = new AnchorClient(config);
  const clobStore = new ClobStore(config.clobDbPath);
  const matchingEngine = new MatchingEngine(clobStore);
  const fillSettlement = new FillSettlementQueue(clobStore, anchorClient);
  const orderCleanup = new OrderCleanupProcessor(clobStore, anchorClient);
  const clobLifecycle = new ClobLifecycle(clobStore, {
    lock: (market) => anchorClient.lockMarket(market.market).then(() => undefined),
    getState: (market) => anchorClient.getMarketState(market.market),
  }, orderCleanup);
  const clobWsApi = new ClobWsApi(wsServer, clobStore, matchingEngine, {
    network: config.solanaRpcUrl.includes("devnet") ? "devnet" : "mainnet-beta",
    programId: config.kicktickProgramId.toBase58(),
    connection: rpcConnection,
    onFills: async market => {
      for (const fill of clobStore.listPendingFills().filter(candidate => candidate.market === market && candidate.status === "MATCHED")) {
        await fillSettlement.submit(fill);
      }
    },
  });

  fillSettlement.on("confirmed", fill => { if (fill) clobWsApi.publishMarket(fill.market); });
  fillSettlement.on("failed", fill => { if (fill) clobWsApi.publishMarket(fill.market); });

  return { rpcConnection, wsServer, txlineClient, anchorClient, clobStore, matchingEngine, fillSettlement, orderCleanup, clobLifecycle, clobWsApi };
}
