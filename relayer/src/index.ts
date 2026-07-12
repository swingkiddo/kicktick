import { runRelayer } from "./app/relayer-runtime";

runRelayer().catch((error: unknown) => {
  console.error("Fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
