import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  canonicalCancellationMessage,
  canonicalOrderMessage,
  orderId,
  ProtocolError,
  verifySignedCancellation,
  verifySignedOrder,
} from "../../../src/clob/protocol";
import type { CancellationPayload, OrderPayload } from "../../../src/clob/types";

describe("CLOB signed protocol", () => {
  const owner = Keypair.generate();
  const market = Keypair.generate().publicKey.toBase58();
  const program = Keypair.generate().publicKey.toBase58();
  const payload: OrderPayload = { version: 1, network: "devnet", program_id: program, market, owner: owner.publicKey.toBase58(), side: "BUY", outcome_index: 1, price_bps: 3200, quantity: "420", nonce: "7", expires_at: 2_000_000_000 };
  const signed = () => ({ payload, signature: Buffer.from(nacl.sign.detached(canonicalOrderMessage(payload), owner.secretKey)).toString("base64") });

  it("has stable canonical bytes and verifies deterministic IDs", () => {
    expect(Buffer.from(canonicalOrderMessage(payload)).toString()).to.equal(
      `kicktick-clob-order\nversion=1\nnetwork=devnet\nprogram_id=${program}\nmarket=${market}\nowner=${owner.publicKey.toBase58()}\nside=BUY\noutcome_index=1\nprice_bps=3200\nquantity=420\nnonce=7\nexpires_at=2000000000\n`,
    );
    const result = verifySignedOrder(signed(), 1_900_000_000);
    expect(result.quantity).to.equal(420n);
    expect(result.id).to.equal(orderId(payload, Buffer.from(signed().signature, "base64")));
  });

  it("rejects mutated messages and invalid ticks", () => {
    const bad = signed();
    bad.payload = { ...bad.payload, price_bps: 3250 };
    expect(() => verifySignedOrder(bad, 1_900_000_000)).to.throw(ProtocolError, "100 bps tick");
    const invalidSignature = { ...signed(), signature: Buffer.alloc(64).toString("base64") };
    expect(() => verifySignedOrder(invalidSignature, 1_900_000_000)).to.throw(ProtocolError, "invalid Ed25519 signature");
  });

  it("verifies independently signed cancellations", () => {
    const cancellation: CancellationPayload = { version: 1, network: "devnet", program_id: program, owner: owner.publicKey.toBase58(), order_id: "a".repeat(64), nonce: "8", expires_at: 2_000_000_000 };
    const signature = Buffer.from(nacl.sign.detached(canonicalCancellationMessage(cancellation), owner.secretKey)).toString("base64");
    expect(() => verifySignedCancellation({ payload: cancellation, signature }, 1_900_000_000)).not.to.throw();
  });
});
