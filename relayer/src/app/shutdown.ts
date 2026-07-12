export interface ShutdownDependencies {
  stopSchedulers(): void;
  stopCronWindows(): void;
  stopUpstream(): Promise<void>;
  drainWork(): Promise<void>;
  closeTransport(): void;
  closeLogger(): void;
  closeStorage(): void;
}

export function registerShutdown(dependencies: ShutdownDependencies): void {
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");
    dependencies.stopSchedulers();
    dependencies.stopCronWindows();
    dependencies.closeTransport();
    await dependencies.stopUpstream();
    await dependencies.drainWork();
    dependencies.closeLogger();
    dependencies.closeStorage();
    console.log("Goodbye.");
  };
  process.once("SIGINT", () => { void shutdown().catch(fatalShutdown); });
  process.once("SIGTERM", () => { void shutdown().catch(fatalShutdown); });
}

function fatalShutdown(error: unknown): void {
  console.error("Shutdown failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
