import dotenv from "dotenv";
import { PublicKey } from "@solana/web3.js";

dotenv.config();

export interface Config {
  txlineJwt: string;
  txlineApiToken: string;
  txlineApiHost: string;
  solanaRpcUrl: string;
  solanaKeypairPath: string;
  kicktickProgramId: PublicKey;
  txoracleProgramId: PublicKey;
  usdtMint: PublicKey;
  txlMint: PublicKey;
  wsPort: number;
  competitionId: number;
}

export function loadConfig(): Config {
  return {
    txlineJwt: process.env.TXLINE_JWT || "",
    txlineApiToken: process.env.TXLINE_API_TOKEN || "",
    txlineApiHost: process.env.TXLINE_API_HOST || "https://txline-dev.txodds.com",
    solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    solanaKeypairPath:
      process.env.SOLANA_KEYPAIR_PATH || "~/.config/solana/id.json",
    kicktickProgramId: new PublicKey(
      process.env.KICKTICK_PROGRAM_ID ||
        "CCmcpUZttSJqUabxBcyvHp4uC89EkrXce5YSEvRgE7tc"
    ),
    txoracleProgramId: new PublicKey(
      process.env.TXORACLE_PROGRAM_ID ||
        "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
    ),
    usdtMint: new PublicKey(
      process.env.USDT_MINT ||
        "ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh"
    ),
    txlMint: new PublicKey(
      process.env.TXL_MINT ||
        "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"
    ),
    wsPort: parseInt(process.env.WS_PORT || "8080", 10),
    competitionId: parseInt(process.env.COMPETITION_ID || "72", 10),
  };
}
