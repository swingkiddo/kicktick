import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import type { Idl } from "@anchor-lang/core/dist/cjs/idl";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import type { Config } from "../../config";
import { solanaRpcFetch } from "../../clients/solana-rpc";
import { AnchorClientError } from "./errors";

const kicktickIdl: Idl = require("../../idl/kicktick.json");

export class SolanaContext {
  readonly connection: Connection;
  readonly provider: AnchorProvider;
  readonly program: Program;

  constructor(readonly config: Config) {
    const keypair = Keypair.fromSecretKey(Buffer.from(config.solanaPrivateKey, "hex"));
    this.connection = new Connection(config.solanaRpcUrl, {
      commitment: "confirmed",
      fetch: solanaRpcFetch,
      disableRetryOnRateLimit: true,
    });
    this.provider = new AnchorProvider(
      this.connection,
      new Wallet(keypair),
      { commitment: "confirmed", preflightCommitment: "confirmed" },
    );
    this.program = new Program(
      { ...kicktickIdl, address: config.kicktickProgramId.toBase58() },
      this.provider,
    );
  }

  get programId(): PublicKey { return this.program.programId; }
  get walletPublicKey(): PublicKey { return this.provider.wallet.publicKey; }

  async send(transaction: Promise<Transaction>, cuLimit?: number, signers?: Keypair[]): Promise<string> {
    let tx: Transaction;
    try {
      tx = await transaction;
    } catch (error) {
      throw new AnchorClientError(`Failed to build transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (cuLimit && cuLimit > 0) {
      tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit })).add(tx);
    }
    try {
      return await this.provider.sendAndConfirm(tx, signers);
    } catch (error: any) {
      const logs = error?.logs as string[] | undefined;
      const anchorError = logs?.find(line => line.includes("Error Code:") || line.includes("failed"));
      throw new AnchorClientError(anchorError ?? `Transaction failed: ${error instanceof Error ? error.message : String(error)}`, logs);
    }
  }
}
