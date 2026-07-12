import type { Connection } from "@solana/web3.js";
import type { FixtureRecord } from "@swingkiddo/txodds-client";
import type { Config } from "../config";
import { AnchorClient } from "../clients/anchor-client";
import type { TxLineClient } from "../clients/txline-client";
import type { ClobStore } from "../clob/store";
import { StatusId } from "../domain/football/types";
import type { FixtureWatcher } from "../market/fixture-watcher";
import type { MarketTrigger } from "../market/triggers";

export interface FixtureRuntimeDependencies {
  config: Config;
  rpcConnection: Connection;
  txlineClient: TxLineClient;
  anchorClient: AnchorClient;
  clobStore: ClobStore;
  fixtureWatcher: FixtureWatcher;
  marketTrigger: MarketTrigger;
}

export class FixtureRuntime {
  constructor(private readonly dependencies: FixtureRuntimeDependencies) {}

  async reconcileOnChainMatches(): Promise<void> {
    const { anchorClient, clobStore } = this.dependencies;
    try {
      const matches = await anchorClient.listMatches();
      for (const match of matches) this.persistMatch(match);
      console.log(`  Match reconciliation: ${matches.length} on-chain matches imported`);
    } catch (error) {
      console.warn(`  Match reconciliation deferred: ${error instanceof Error ? error.message : error}`);
    }
  }

  async loadCompetitionFixtures(): Promise<void> {
    const { config, txlineClient, fixtureWatcher, marketTrigger, rpcConnection, anchorClient } = this.dependencies;
    console.log(`Fetching fixtures for competition ${config.competitionId} (World Cup)...`);
    let fixtures: FixtureRecord[] = [];
    try {
      fixtures = await txlineClient.getFixtures(config.competitionId);
      console.log(`Loaded ${fixtures.length} fixtures.`);
    } catch (error) {
      console.error("Failed to fetch fixtures:", error instanceof Error ? error.message : error);
    }

    for (const fixture of fixtures) {
      const fixtureId = fixture.FixtureId;
      let matchState: Awaited<ReturnType<FixtureWatcher["loadFixture"]>>;
      try {
        matchState = await fixtureWatcher.loadFixture(fixtureId);
        console.log(`  Fixture ${fixtureId}: ${matchState.participants.home} vs ${matchState.participants.away} [${matchState.currentPeriod}]`);
      } catch (error) {
        console.error(`  Failed to load fixture ${fixtureId}:`, error instanceof Error ? error.message : error);
        continue;
      }

      const [matchPda] = AnchorClient.deriveMatchPda(fixtureId, config.kicktickProgramId);
      const matchOnChain = await rpcConnection.getAccountInfo(matchPda);
      if (matchOnChain) {
        console.log(`  Match ${fixtureId}: already on-chain (${matchPda.toBase58()})`);
        this.persistMatch(await anchorClient.fetchMatchRecord(matchPda));
      } else {
        try {
          const result = await anchorClient.initMatch(fixtureId, matchState.participants.home, matchState.participants.away);
          this.persistMatch(await anchorClient.fetchMatchRecord(result.matchPda));
          console.log(`  Match ${fixtureId}: created on-chain (${matchPda.toBase58()}, tx: ${result.sig})`);
        } catch (error) {
          console.error(`  Match ${fixtureId}: initMatch failed — skipping`, error instanceof Error ? error.message : error);
          continue;
        }
      }
      marketTrigger.startCronWindows(fixtureId);
    }
  }

  restorePersistedFixtures(): void {
    const { config, clobStore, fixtureWatcher, marketTrigger } = this.dependencies;
    for (const match of clobStore.listMatches()) {
      const fixtureId = Number(match.fixture_id);
      if (fixtureWatcher.getFixtureState(fixtureId)) continue;
      fixtureWatcher.registerSyntheticFixture(fixtureId, match.home_team, match.away_team, StatusId.NotStarted);
      if (config.testMode) marketTrigger.startCronWindows(fixtureId);
      console.log(`  Match ${fixtureId}: restored from SQLite (${match.match})`);
    }
  }

  private persistMatch(match: Awaited<ReturnType<AnchorClient["fetchMatchRecord"]>>): void {
    this.dependencies.clobStore.upsertMatch({
      fixture_id: String(match.fixtureId), match: match.matchPda.toBase58(), status: match.status,
      home_team: match.homeTeam, away_team: match.awayTeam, competition_id: match.competitionId,
      created_at: match.createdAt * 1000,
    });
  }
}
