import { BN } from "@anchor-lang/core";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { StoredOrder } from "../../clob/types";
import type { Fill } from "../../domain/settlement/types";
import type { SolanaContext } from "./context";
import type { PdaFactory } from "./pda-factory";
import { AnchorClientError } from "./errors";

export class FillGateway {
  constructor(private readonly context: SolanaContext, private readonly pdas: PdaFactory) {}
  async expireOrder(order: StoredOrder): Promise<string> { const owner = new PublicKey(order.owner), market = new PublicKey(order.market); return this.context.send((this.context.program.methods as any).expireOrder().accountsStrict({ relayer: this.context.walletPublicKey, config: this.pdas.config()[0], userAccount: this.pdas.userAccount(owner)[0], order: new PublicKey(order.order_pda), market, position: this.pdas.position(market, owner)[0] }).transaction()); }
  async cancelOrderAfterLock(order: StoredOrder): Promise<string> { const owner = new PublicKey(order.owner), market = new PublicKey(order.market); return this.context.send((this.context.program.methods as any).cancelOrderAfterLock().accountsStrict({ relayer: this.context.walletPublicKey, config: this.pdas.config()[0], owner, userAccount: this.pdas.userAccount(owner)[0], order: new PublicKey(order.order_pda), market, position: this.pdas.position(market, owner)[0] }).transaction()); }
  async settleClobFill(fill: Fill, buyerOrder: string, sellerOrder: string): Promise<string> {
    if (fill.kind !== "DIRECT" || !fill.buyer || !fill.seller || fill.outcome_index === undefined) throw new AnchorClientError(`fill ${fill.id} is not a complete direct fill`);
    const market = new PublicKey(fill.market), buyer = new PublicKey(fill.buyer), seller = new PublicKey(fill.seller);
    return this.context.send((this.context.program.methods as any).settleShareTrade(new BN(fill.market_sequence.toString()), fill.outcome_index, fill.prices_bps[0], new BN(fill.quantity.toString())).accountsStrict({ relayer: this.context.walletPublicKey, config: this.pdas.config()[0], market, buyer, buyerAccount: this.pdas.userAccount(buyer)[0], buyerVault: this.pdas.userVault(buyer)[0], buyerPosition: this.pdas.position(market, buyer)[0], seller, buyerOrder: new PublicKey(buyerOrder), sellerAccount: this.pdas.userAccount(seller)[0], sellerVault: this.pdas.userVault(seller)[0], sellerPosition: this.pdas.position(market, seller)[0], sellerOrder: new PublicKey(sellerOrder), systemProgram: SystemProgram.programId }).transaction());
  }
  async settleCompleteSetFill(fill: Fill, orders: StoredOrder[]): Promise<string> {
    if (orders.length !== 2 || fill.prices_bps.length !== 2 || orders.some((order, index) => order.outcome_index !== index)) throw new AnchorClientError("complete-set fills require two orders sorted by outcome index");
    const market = new PublicKey(fill.market);
    const remainingAccounts = orders.flatMap(order => { const owner = new PublicKey(order.owner); return [{ pubkey: this.pdas.userAccount(owner)[0], isSigner: false, isWritable: true }, { pubkey: this.pdas.userVault(owner)[0], isSigner: false, isWritable: true }, { pubkey: new PublicKey(order.order_pda), isSigner: false, isWritable: true }, { pubkey: this.pdas.position(market, owner)[0], isSigner: false, isWritable: true }]; });
    return this.context.send((this.context.program.methods as any).settleCompleteSet(new BN(fill.market_sequence.toString()), fill.prices_bps, new BN(fill.quantity.toString())).accountsStrict({ relayer: this.context.walletPublicKey, config: this.pdas.config()[0], market, marketVault: this.pdas.marketVault(market)[0], collateralMint: this.context.config.collateralMint, tokenProgram: TOKEN_PROGRAM_ID }).remainingAccounts(remainingAccounts).transaction());
  }
}
