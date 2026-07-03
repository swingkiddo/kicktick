import { loadConfig } from "./config";

function main() {
  const config = loadConfig();

  console.log("KickTick Relayer v0.1.0");
  console.log(`  Solana RPC:      ${config.solanaRpcUrl}`);
  console.log(`  Keypair:         ${config.solanaKeypairPath}`);
  console.log(`  KickTick PID:    ${config.kicktickProgramId.toBase58()}`);
  console.log(`  TxOracle PID:    ${config.txoracleProgramId.toBase58()}`);
  console.log(`  WS Port:         ${config.wsPort}`);

  // TODO: Authenticate with TxLINE (JWT + API token)
  // TODO: Connect to TxLINE SSE stream for scores/odds
  // TODO: Monitor on-chain market states and trigger round transitions
  // TODO: Settlement crank — gather Merkle proofs and submit to Solana
  // TODO: WebSocket server for real-time status updates
}

main();
