import type { Connection } from "@solana/web3.js";
import type { WsServer } from "../api/ws-server";
import type { AnchorClient } from "../clients/anchor-client";
import type { OrderCleanupProcessor } from "../clob/cleanup";
import type { FixtureWatcher } from "../market/fixture-watcher";
import type { MarketActionExecutor } from "../market/action-executor";
import type { MarketTrigger, TriggerAction } from "../market/triggers";

export interface SchedulerDependencies {
  fixtureWatcher: FixtureWatcher;
  marketTrigger: MarketTrigger;
  marketActions: MarketActionExecutor;
  anchorClient: AnchorClient;
  orderCleanup: OrderCleanupProcessor;
  rpcConnection: Connection;
  wsServer: WsServer;
  summarize: (actions: TriggerAction[]) => string;
}

export class RelayerScheduler {
  private timers: Array<ReturnType<typeof setInterval>> = [];

  constructor(private readonly dependencies: SchedulerDependencies) {}

  start(): void {
    const { fixtureWatcher, marketTrigger, marketActions, anchorClient, orderCleanup, rpcConnection, wsServer, summarize } = this.dependencies;
    this.timers.push(setInterval(() => {
      for (const matchState of fixtureWatcher.getAllFixtures()) {
        try {
          const actions = marketTrigger.checkTimeouts(matchState.fixtureId);
          if (actions.length) {
            console.log(`[TIMEOUT] fixture=${matchState.fixtureId} actions=${summarize(actions)}`);
            marketActions.enqueue(actions).catch((error: Error) => console.error(`Timeout actions error [${matchState.fixtureId}]: ${error.message}`));
          }
        } catch (error) {
          console.error(`Timeout check error [${matchState.fixtureId}]:`, error instanceof Error ? error.message : error);
        }
      }
      marketActions.recover(anchorClient).catch(error => console.warn("Periodic market lifecycle recovery failed:", error instanceof Error ? error.message : error));
    }, 5_000));
    this.timers.push(setInterval(() => {
      orderCleanup.enqueueExpired();
      orderCleanup.processPending().catch(error => console.warn("Order cleanup failed:", error instanceof Error ? error.message : error));
    }, 5_000));
    this.timers.push(setInterval(() => {
      for (const matchState of fixtureWatcher.getAllFixtures()) {
        try { marketTrigger.runCronCheck(matchState.fixtureId, matchState); }
        catch (error) { console.error(`Cron window check error [${matchState.fixtureId}]:`, error instanceof Error ? error.message : error); }
      }
    }, 60_000));
    this.timers.push(setInterval(() => {
      void rpcConnection.getBalance(anchorClient.walletPublicKey).catch(() => 0).then(solBalance => wsServer.broadcast({
        type: "system_status",
        data: { clientCount: wsServer.clientCount, uptime: process.uptime(), activeFixtureCount: fixtureWatcher.getAllFixtures().length, solBalance },
      }));
    }, 30_000));
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}
