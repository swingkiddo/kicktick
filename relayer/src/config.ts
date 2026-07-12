import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { PublicKey } from "@solana/web3.js";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const constantsPath = path.resolve(__dirname, "../config/constants.json");
const constants = JSON.parse(fs.readFileSync(constantsPath, "utf-8"));

export const DEFAULT_KICKTICK_PROGRAM_ID = new PublicKey(constants.kicktickProgramId);
export const DEFAULT_TXORACLE_PROGRAM_ID = new PublicKey(constants.txoracleProgramId);

export interface Config {
  txlineJwt: string;
  txlineApiToken: string;
  txlineApiHost: string;
  solanaRpcUrl: string;
  solanaPrivateKey: string;
  kicktickProgramId: PublicKey;
  txoracleProgramId: PublicKey;
  collateralMint: PublicKey;
  txlMint: PublicKey;
  wsPort: number;
  competitionId: number;
  clobDbPath: string;
  testMode: boolean;
}

export function loadConfig(): Config {
  let solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY || "";
  if (!solanaPrivateKey) {
    const configuredPath = process.env.SOLANA_KEYPAIR_PATH || "~/.config/solana/id.json";
    const keypairPath = configuredPath.startsWith("~/")
      ? path.join(process.env.HOME || "/root", configuredPath.slice(2))
      : configuredPath;
    try {
      const secret = JSON.parse(fs.readFileSync(keypairPath, "utf8")) as unknown;
      if (!Array.isArray(secret) || secret.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new Error("keypair must be a byte array");
      }
      solanaPrivateKey = Buffer.from(secret).toString("hex");
    } catch (error) {
      throw new Error(`Unable to load Solana keypair from ${keypairPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    txlineJwt: process.env.TXLINE_JWT || "",
    txlineApiToken: process.env.TXLINE_API_TOKEN || "",
    txlineApiHost: process.env.TXLINE_API_HOST || constants.txlineApiHost,
    solanaRpcUrl: process.env.SOLANA_RPC_URL || constants.solanaRpcUrl,
    solanaPrivateKey,
    kicktickProgramId: new PublicKey(
      process.env.KICKTICK_PROGRAM_ID || constants.kicktickProgramId
    ),
    txoracleProgramId: new PublicKey(
      process.env.TXORACLE_PROGRAM_ID || constants.txoracleProgramId
    ),
    collateralMint: new PublicKey(
      process.env.COLLATERAL_MINT || constants.collateralMint
    ),
    txlMint: new PublicKey(
      process.env.TXL_MINT || constants.txlMint
    ),
    wsPort: parseInt(process.env.WS_PORT || String(constants.wsPort), 10),
    competitionId: parseInt(process.env.COMPETITION_ID || String(constants.competitionId), 10),
    clobDbPath: process.env.CLOB_DB_PATH || path.resolve(__dirname, "../data/clob.sqlite"),
    // Dev control is enabled automatically for local development; production
    // still requires an explicit TEST_MODE=true opt-in.
    testMode: process.env.TEST_MODE === "true" || process.env.NODE_ENV === "development",
  };
}
