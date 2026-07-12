import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useTestWallets } from './TestWalletContext';
import { KICKTICK_CONFIG, KicktickClient } from './kicktickClient';
import { ORDER_PROTOCOL_VERSION, bytesToBase64, canonicalOrderMessage, orderId, signCancellation, signOrder, type UnsignedCancellation, type UnsignedOrder } from './orders';
import type { ClobFill, ClobMarket, ClobOrder, OrderBook, PositionView } from './clobTypes';

type IncomingMessage = { type: string; data?: any; requestId?: string };
type PendingRequest = { resolve: (value: any) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout> };
type OrderInput = {
  market: string;
  side: UnsignedOrder['side'];
  outcomeIndex: number;
  priceBps: number;
  quantity: string;
  expiresAt: number;
};

export interface ClobSigner {
  owner: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

interface ClobContextValue {
  connected: boolean;
  authenticated: boolean;
  error?: string;
  markets: ClobMarket[];
  books: Record<string, OrderBook>;
  orders: ClobOrder[];
  fills: ClobFill[];
  positions: PositionView[];
  subscribeOrderbook: (market: string, outcomeIndex: number) => void;
  submitOrder: (order: OrderInput) => Promise<string>;
  cancelOrder: (orderId: string) => Promise<void>;
  cancelAllOpenOrders: () => Promise<void>;
}

const ClobContext = createContext<ClobContextValue | undefined>(undefined);

const wsUrl = () => {
  if (import.meta.env.VITE_RELAYER_WS_URL) return import.meta.env.VITE_RELAYER_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname || 'localhost'}:8080`;
};

const MAX_RECONNECT_DELAY_MS = 10_000;
const nonce = () => `${Date.now()}${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`;
const number = (value: unknown): number => typeof value === 'number' ? value : Number(value ?? 0);

function normalizeMarket(data: any): ClobMarket {
  return {
    address: String(data.address ?? data.market ?? data.marketPda),
    fixtureId: String(data.fixtureId ?? data.fixture_id ?? ''),
    marketType: String(data.marketType ?? data.market_type ?? 'Market'),
    marketSeq: String(data.marketSeq ?? data.market_seq ?? ''),
    title: String(data.title ?? data.description ?? data.marketType ?? 'Live market'),
    expiresAt: number(data.expiresAt ?? data.expires_at),
    outcomeNames: data.outcomeNames ?? data.outcomes ?? ['Yes', 'No'],
    status: String(data.status ?? 'OPEN').toUpperCase() as ClobMarket['status'],
    fillSequence: data.fillSequence?.toString?.() ?? data.fill_sequence?.toString?.() ?? data.chain_fill_sequence?.toString?.(),
    totalVolume: data.totalVolume?.toString?.() ?? data.total_volume?.toString?.(),
  };
}

function normalizeOrder(data: any): ClobOrder {
  return {
    id: String(data.id ?? data.orderId), market: String(data.market), owner: String(data.owner), orderPda: data.orderPda ?? data.order_pda,
    side: String(data.side).toUpperCase() as ClobOrder['side'], outcomeIndex: number(data.outcomeIndex ?? data.outcome_index),
    priceBps: number(data.priceBps ?? data.price_bps), quantity: String(data.quantity ?? data.original_quantity),
    remainingQuantity: String(data.remainingQuantity ?? data.remaining_quantity ?? data.quantity ?? data.original_quantity),
    status: String(data.status ?? 'OPEN').toUpperCase() as ClobOrder['status'],
    createdAt: data.createdAt ?? data.created_at, settlementStatus: data.settlementStatus ?? data.settlement_status,
  };
}

function normalizeBook(data: any, outcomeIndex = 0): OrderBook {
  const levels = (items: any[] | undefined) => (items ?? []).map((level) => ({
    priceBps: number(level.priceBps ?? level.price_bps ?? level.price), quantity: String(level.quantity ?? level.remainingQuantity),
  }));
  return {
    market: String(data.market), outcomeIndex,
    bids: levels(Array.isArray(data.bids) ? data.bids : data.bids?.[outcomeIndex]),
    asks: levels(Array.isArray(data.asks) ? data.asks : data.asks?.[outcomeIndex]),
    updatedAt: number(data.updatedAt ?? Date.now()),
  };
}

export function ClobProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const { selected: testWallet } = useTestWallets();
  const signer: ClobSigner | undefined = useMemo(() => testWallet
    ? { owner: testWallet.publicKey.toBase58(), signMessage: testWallet.signMessage }
    : wallet.publicKey && wallet.signMessage
      ? { owner: wallet.publicKey.toBase58(), signMessage: wallet.signMessage }
      : undefined, [testWallet, wallet.publicKey, wallet.signMessage]);
  const chainWallet = useMemo(() => signer && (testWallet ? { publicKey: testWallet.publicKey, signTransaction: testWallet.signTransaction, signAllTransactions: testWallet.signAllTransactions } : wallet.publicKey && wallet.signTransaction ? { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction, signAllTransactions: wallet.signAllTransactions } : undefined), [signer, testWallet, wallet.publicKey, wallet.signAllTransactions, wallet.signTransaction]);
  const socket = useRef<WebSocket | null>(null);
  const subscriptions = useRef(new Set<string>());
  const pending = useRef(new Map<string, PendingRequest>());
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string>();
  const [markets, setMarkets] = useState<ClobMarket[]>([]);
  const [books, setBooks] = useState<Record<string, OrderBook>>({});
  const [orders, setOrders] = useState<ClobOrder[]>([]);
  const [fills, setFills] = useState<ClobFill[]>([]);
  const [positions, setPositions] = useState<PositionView[]>([]);

  const send = useCallback((message: object) => {
    if (socket.current?.readyState !== WebSocket.OPEN) throw new Error('Relayer is disconnected.');
    socket.current.send(JSON.stringify(message));
  }, []);

  const request = useCallback((type: string, data: object, timeoutMs = 8_000) => new Promise<any>((resolve, reject) => {
    const id = type;
    const timeout = setTimeout(() => {
      pending.current.delete(id);
      reject(new Error('Relayer did not acknowledge the request.'));
    }, timeoutMs);
    pending.current.set(id, { resolve, reject, timeout });
    try { send({ type, data }); } catch (requestError) {
      clearTimeout(timeout); pending.current.delete(id); reject(requestError);
    }
  }), [send]);

  const subscribeOrderbook = useCallback((market: string, outcomeIndex: number) => {
    const key = `${market}:${outcomeIndex}`;
    subscriptions.current.add(key);
    if (socket.current?.readyState === WebSocket.OPEN) send({ type: 'subscribe_orderbook', data: { market } });
  }, [send]);

  const authenticate = useCallback(async (challenge: string) => {
    if (!signer) return;
    try {
      const owner = signer.owner;
      const message = `kicktick-clob-auth\nowner=${owner}\nchallenge=${challenge}\n`;
      const signature = await signer.signMessage(new TextEncoder().encode(message));
      send({ type: 'auth_response', data: { owner, signature: bytesToBase64(signature) } });
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Wallet authentication was declined.');
    }
  }, [send, signer]);

  useEffect(() => {
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(wsUrl());
      socket.current = ws;
      ws.onopen = () => {
        reconnectAttempt.current = 0;
        setConnected(true); setError(undefined);
        if (signer) ws.send(JSON.stringify({ type: 'auth_challenge', data: { owner: signer.owner } }));
        for (const subscription of subscriptions.current) {
          const [market] = subscription.split(':');
          ws.send(JSON.stringify({ type: 'subscribe_orderbook', data: { market } }));
        }
      };
      ws.onmessage = (event) => {
        let message: IncomingMessage;
        try { message = JSON.parse(event.data) as IncomingMessage; } catch { return; }
        const responseTo = message.type === 'order_ack' || message.type === 'order_rejected' ? 'submit_order'
          : message.type === 'order_cancelled' ? 'cancel_order'
            : message.type === 'cancel_all_ack' ? 'cancel_all' : undefined;
        if (responseTo && pending.current.has(responseTo)) {
          const item = pending.current.get(responseTo)!;
          clearTimeout(item.timeout); pending.current.delete(responseTo);
          if (message.type === 'order_rejected') item.reject(new Error(message.data?.message ?? 'Relayer rejected order.'));
          else item.resolve(message.data);
        }
        switch (message.type) {
          case 'auth_challenge': {
            const challenge = message.data?.challenge;
            if (typeof challenge === 'string') void authenticate(challenge);
            break;
          }
          case 'authenticated':
            setAuthenticated(true);
            break;
          case 'markets': case 'market_snapshot':
            setMarkets((message.data?.markets ?? message.data ?? []).map(normalizeMarket)); break;
          case 'market_update': {
            const next = normalizeMarket(message.data);
            setMarkets((previous) => [...previous.filter((market) => market.address !== next.address), next]); break;
          }
          case 'orderbook': case 'orderbook_snapshot': {
            const indices = new Set([...Object.keys(message.data?.bids ?? {}), ...Object.keys(message.data?.asks ?? {})].map(Number));
            if (!indices.size) indices.add(0);
            setBooks((previous) => {
              const next = { ...previous };
              for (const index of indices) {
                const book = normalizeBook(message.data, index);
                next[`${book.market}:${index}`] = book;
              }
              return next;
            }); break;
          }
          case 'order_update': {
            const next = normalizeOrder(message.data?.order ?? message.data);
            setOrders((previous) => [...previous.filter((order) => order.id !== next.id), next]); break;
          }
          case 'orders': case 'private_orders':
            setOrders((message.data?.orders ?? message.data ?? []).map(normalizeOrder)); break;
          case 'fill_update': {
            const fill = message.data?.fill ?? message.data;
            const nextFill = { id: String(fill.id), market: String(fill.market), outcomeIndex: number(fill.outcomeIndex ?? fill.outcome_index), quantity: String(fill.quantity), priceBps: number(fill.priceBps ?? fill.prices_bps?.[0]), status: String(fill.status).toUpperCase() as ClobFill['status'], transactionSignature: fill.transactionSignature ?? fill.tx_signature, createdAt: fill.createdAt ?? fill.created_at };
            setFills((previous) => [nextFill, ...previous.filter((item) => item.id !== nextFill.id)].slice(0, 100)); break;
          }
          case 'positions': case 'private_positions':
            setPositions(message.data?.positions ?? message.data ?? []); break;
          case 'error':
            setError(message.data?.message ?? 'Relayer error.'); break;
        }
      };
      ws.onclose = () => {
        setConnected(false); setAuthenticated(false);
        if (!stopped) {
          const delay = Math.min(1_000 * 2 ** reconnectAttempt.current++, MAX_RECONNECT_DELAY_MS);
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socket.current?.close();
      for (const item of pending.current.values()) { clearTimeout(item.timeout); item.reject(new Error('Relayer connection closed.')); }
      pending.current.clear();
    };
  }, [authenticate, signer]);

  const submitOrder = useCallback(async (input: OrderInput) => {
    if (!signer) throw new Error('Select a test wallet or connect a wallet that supports message signing.');
    if (!chainWallet) throw new Error('Wallet cannot sign transactions.');
    const nonceValue = BigInt(nonce());
    const chain = new KicktickClient(chainWallet as any);
    const created = await chain.createOrder({ ...input, nonce: nonceValue });
    const signed = await signOrder({
      version: ORDER_PROTOCOL_VERSION,
      network: 'devnet',
      program_id: KICKTICK_CONFIG.programId,
      market: input.market,
      owner: signer.owner,
      side: input.side,
      outcome_index: input.outcomeIndex,
      price_bps: input.priceBps,
      quantity: input.quantity,
      nonce: nonceValue.toString(), order_pda: created.orderPda.toBase58(), create_tx_signature: created.signature,
      expires_at: input.expiresAt,
    }, signer.signMessage);
    const signature = Uint8Array.from(atob(signed.signature), (character) => character.charCodeAt(0));
    const deterministicId = await orderId(canonicalOrderMessage(signed.payload), signature);
    const acknowledgement = await request('submit_order', signed);
    const order = normalizeOrder({ ...signed.payload, id: acknowledgement?.order_id ?? deterministicId, remaining_quantity: acknowledgement?.remaining_quantity ?? signed.payload.quantity, status: acknowledgement?.status ?? 'OPEN' });
    setOrders((previous) => [...previous.filter((item) => item.id !== order.id), order]);
    return order.id;
  }, [chainWallet, request, signer]);

  const cancelOrder = useCallback(async (orderId: string) => {
    if (!signer) throw new Error('Select a test wallet or connect a wallet that supports message signing.');
    if (!chainWallet) throw new Error('Wallet cannot sign transactions.');
    const current = orders.find((order) => order.id === orderId);
    if (!current?.orderPda) throw new Error('Order is missing its on-chain PDA.');
    const cancelSignature = await new KicktickClient(chainWallet as any).cancelOrder(current.orderPda);
    const cancellation: UnsignedCancellation = { version: ORDER_PROTOCOL_VERSION, network: 'devnet', program_id: KICKTICK_CONFIG.programId, owner: signer.owner, order_id: orderId, nonce: nonce(), expires_at: Math.floor(Date.now() / 1000) + 60, order_pda: current.orderPda, cancel_tx_signature: cancelSignature };
    await request('cancel_order', await signCancellation(cancellation, signer.signMessage));
    setOrders((previous) => previous.map((order) => order.id === orderId ? { ...order, status: 'CANCELLED' } : order));
  }, [chainWallet, orders, request, signer]);

  const cancelAllOpenOrders = useCallback(async () => {
    if (!signer) throw new Error('Select a test wallet or connect a wallet that supports message signing.');
    await request('cancel_all', {});
    setOrders((previous) => previous.map((order) => order.owner === signer.owner && (order.status === 'OPEN' || order.status === 'PARTIAL') ? { ...order, status: 'CANCELLED' } : order));
  }, [request, signer]);

  const value = useMemo(() => ({ connected, authenticated, error, markets, books, orders, fills, positions, subscribeOrderbook, submitOrder, cancelOrder, cancelAllOpenOrders }), [authenticated, books, cancelAllOpenOrders, cancelOrder, connected, error, fills, markets, orders, positions, submitOrder, subscribeOrderbook]);
  return <ClobContext.Provider value={value}>{children}</ClobContext.Provider>;
}

export function useClob() {
  const context = useContext(ClobContext);
  if (!context) throw new Error('useClob must be used within ClobProvider.');
  return context;
}
