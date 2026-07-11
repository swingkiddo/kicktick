import fs from "fs";
import path from "path";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { WebSocket } from "ws";
import { canonicalOrderMessage } from "../clob/protocol";
import { SignedOrder, OrderPayload } from "../clob/types";

const wsUrl = process.env.TEST_WS_URL || "ws://127.0.0.1:8080";
const walletDir = process.env.TEST_WALLETS_DIR || path.resolve(__dirname, "../../../kicktick/scripts/wallets");
const names = (process.env.TEST_WALLETS || "wallet-01.json,wallet-02.json").split(",").map(value => value.trim()).filter(Boolean);
const market = process.env.TEST_MARKET || "";
const programId = process.env.KICKTICK_PROGRAM_ID || "7Pc2ipKnDya7UKhQVQA2zdateaLpgHGQbyNt34R5dNF4";
const quantity = process.env.TEST_QUANTITY || "100";
const price = Number(process.env.TEST_PRICE_BPS || "5000");

function load(name: string): Keypair {
  const bytes = JSON.parse(fs.readFileSync(path.join(walletDir, name), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function signedOrder(wallet: Keypair, side: "BUY" | "SELL", nonce: string): SignedOrder {
  const payload: OrderPayload = {
    version: 1, network: "devnet", program_id: programId, market,
    owner: wallet.publicKey.toBase58(), side, outcome_index: 0,
    price_bps: price, quantity, nonce, expires_at: Math.floor(Date.now() / 1000) + 3600,
    order_pda: "11111111111111111111111111111111", create_tx_signature: "test-only",
  };
  return { payload, signature: Buffer.from(nacl.sign.detached(canonicalOrderMessage(payload), wallet.secretKey)).toString("base64") };
}

function send(socket: WebSocket, message: unknown): void { socket.send(JSON.stringify(message)); }

async function run(wallet: Keypair, side: "BUY" | "SELL", nonce: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const owner = wallet.publicKey.toBase58();
    const fail = (error: Error) => { socket.close(); reject(error); };
    socket.once("error", fail);
    socket.on("message", raw => {
      const message = JSON.parse(raw.toString()) as { type: string; data?: any };
      if (message.type === "welcome") send(socket, { type: "auth_challenge", data: { owner } });
      else if (message.type === "auth_challenge") {
        const bytes = Buffer.from(`kicktick-clob-auth\nowner=${owner}\nchallenge=${message.data.challenge}\n`, "utf8");
        send(socket, { type: "auth_response", data: { owner, signature: Buffer.from(nacl.sign.detached(bytes, wallet.secretKey)).toString("base64") } });
      } else if (message.type === "authenticated") {
        send(socket, { type: "subscribe_market", data: { market } });
        send(socket, { type: "submit_order", data: signedOrder(wallet, side, nonce) });
      } else if (["order_ack", "order_rejected"].includes(message.type)) {
        console.log(`${owner} ${side}: ${message.type}`, JSON.stringify(message.data));
        socket.close(); resolve();
      }
    });
  });
}

async function main(): Promise<void> {
  if (!market) throw new Error("TEST_MARKET is required");
  const wallets = names.map(load);
  for (let index = 0; index < wallets.length; index++) {
    await run(wallets[index], index % 2 === 0 ? "BUY" : "SELL", String(Date.now() + index));
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
