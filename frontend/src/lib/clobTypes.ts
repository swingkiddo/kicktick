export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED';
export type FillStatus = 'MATCHED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
export type MarketStatus = 'OPEN' | 'LOCKED' | 'RESOLVED_PENDING' | 'RESOLVED' | 'VOIDED';

export interface ClobMarket {
  address: string;
  fixtureId: string;
  marketType: string;
  marketSeq: string;
  title: string;
  expiresAt: number;
  outcomeNames: string[];
  status: MarketStatus;
  fillSequence?: string;
  totalVolume?: string;
}

export interface DepthLevel {
  priceBps: number;
  quantity: string;
}

export interface OrderBook {
  market: string;
  outcomeIndex: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  updatedAt: number;
}

export interface ClobOrder {
  id: string;
  market: string;
  owner: string;
  orderPda?: string;
  side: OrderSide;
  outcomeIndex: number;
  priceBps: number;
  quantity: string;
  remainingQuantity: string;
  status: OrderStatus;
  createdAt?: number;
  settlementStatus?: FillStatus;
}

export interface ClobFill {
  id: string;
  market: string;
  outcomeIndex: number;
  quantity: string;
  priceBps: number;
  status: FillStatus;
  transactionSignature?: string;
  createdAt?: number;
}

export interface PositionView {
  market: string;
  marketTitle?: string;
  outcomeNames: string[];
  shares: string[];
  claimableLamports?: string;
  status: MarketStatus;
}
