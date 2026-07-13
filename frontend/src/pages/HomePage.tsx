import { useEffect, useMemo, useState } from 'react';
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { KicktickClient, baseUnitsToUsdc, lamportsToSol, usdcToBaseUnits } from '@/lib/kicktickClient';
import { useClob } from '@/lib/ClobProvider';
import type { ClobMarket, OrderSide } from '@/lib/clobTypes';

const statusColor: Record<string, string> = {
  OPEN: 'bg-teal/15 text-teal', LOCKED: 'bg-yellow-400/15 text-yellow-300',
  RESOLVED_PENDING: 'bg-blue-400/15 text-blue-300', RESOLVED: 'bg-green-400/15 text-green-300', VOIDED: 'bg-gray-400/15 text-gray-300',
  MATCHED: 'bg-blue-400/15 text-blue-300', SUBMITTED: 'bg-yellow-400/15 text-yellow-300', CONFIRMED: 'bg-green-400/15 text-green-300', FAILED: 'bg-red-400/15 text-red-300',
};

function Status({ value }: { value: string }) {
  return <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${statusColor[value] ?? 'bg-white/10 text-gray-300'}`}>{value.replace('_', ' ')}</span>;
}

function timeRemaining(expiresAt: number): string {
  const seconds = Math.max(0, Math.floor(expiresAt - Date.now() / 1000));
  return seconds > 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export default function HomePage() {
  const anchorWallet = useAnchorWallet();
  const wallet = useWallet();
  const { connected, authenticated, error, markets, books, orders, fills, positions, subscribeOrderbook, submitOrder, cancelOrder, cancelAllOpenOrders } = useClob();
  const [selectedMarket, setSelectedMarket] = useState<ClobMarket>();
  const [outcomeIndex, setOutcomeIndex] = useState(0);
  const [side, setSide] = useState<OrderSide>('BUY');
  const [priceBps, setPriceBps] = useState('5000');
  const [orderAmount, setOrderAmount] = useState('0.1');
  const [depositAmount, setDepositAmount] = useState('0.1');
  const [withdrawAmount, setWithdrawAmount] = useState('0.1');
  const [walletBalance, setWalletBalance] = useState<bigint>(0n);
  const [availableBalance, setAvailableBalance] = useState<bigint>(0n);
  const [transactionState, setTransactionState] = useState<string>();

  const client = useMemo(() => anchorWallet ? new KicktickClient(anchorWallet) : undefined, [anchorWallet]);
  const activeMarket = selectedMarket ?? markets.find((market) => market.status === 'OPEN') ?? markets[0];
  const book = activeMarket ? books[`${activeMarket.address}:${outcomeIndex}`] : undefined;
  const orderPreview = useMemo(() => {
    try {
      const price = BigInt(priceBps || '0');
      if (price <= 0n) return { quantity: 0n, cost: 0n };
      const quantity = usdcToBaseUnits(orderAmount);
      const cost = (quantity * price + 9_999n) / 10_000n;
      return { quantity, cost };
    } catch { return { quantity: 0n, cost: 0n }; }
  }, [orderAmount, priceBps]);

  useEffect(() => {
    if (!activeMarket) return;
    setOutcomeIndex((current) => Math.min(current, activeMarket.outcomeNames.length - 1));
  }, [activeMarket?.address, activeMarket?.outcomeNames.length]);

  useEffect(() => {
    if (activeMarket) subscribeOrderbook(activeMarket.address, outcomeIndex);
  }, [activeMarket?.address, outcomeIndex, subscribeOrderbook]);

  const refreshBalances = async () => {
    if (!client) return;
    const [walletLamports, available] = await Promise.all([client.walletBalance(), client.availableBalance()]);
    setWalletBalance(BigInt(walletLamports)); setAvailableBalance(available);
  };
  useEffect(() => { void refreshBalances(); }, [client]);

  const runTransaction = async (label: string, action: () => Promise<string>) => {
    try {
      setTransactionState(`${label} awaiting wallet approval…`);
      const signature = await action();
      setTransactionState(`${label} confirmed: ${signature.slice(0, 12)}…`);
      await refreshBalances();
    } catch (transactionError) {
      setTransactionState(transactionError instanceof Error ? transactionError.message : `${label} failed.`);
    }
  };

  const submit = async () => {
    if (!activeMarket) return;
    try {
      if (activeMarket.outcomeNames.length !== 2) throw new Error('Trading is temporarily limited to binary YES/NO markets.');
      setTransactionState('Signing limit order…');
      if (orderPreview.quantity <= 0n) throw new Error('Order produces zero shares.');
      const orderId = await submitOrder({ market: activeMarket.address, side, outcomeIndex, priceBps: Number(priceBps), quantity: orderPreview.quantity.toString(), expiresAt: Math.max(Math.floor(Date.now() / 1000) + 5, activeMarket.expiresAt - 2) });
      setTransactionState(`Order accepted: ${orderId.slice(0, 12)}…`);
    } catch (submitError) { setTransactionState(submitError instanceof Error ? submitError.message : 'Order was not accepted.'); }
  };

  return (
      <div>
        <section className="px-6 py-10 max-w-7xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-4">
            <span className="gradient-text">KickTick</span>
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-8">
            USDC limit orders for live micro prediction markets.<br />
            Orders match off-chain and settle into fully collateralized on-chain positions.
          </p>
          <div className="flex gap-4 justify-center">
            <a href="#markets" className="btn-secondary">
              Browse live markets
            </a>
          </div>
        </section>

        <section className="px-6 max-w-7xl mx-auto mb-6">
          <div className="card p-4 flex flex-wrap justify-between gap-3 text-sm">
            <span>Relayer: <b className={connected ? 'text-teal' : 'text-red-400'}>{connected ? 'connected' : 'reconnecting'}</b></span>
            <span>Private feed: <b className={authenticated ? 'text-teal' : 'text-yellow-300'}>{authenticated ? 'authenticated' : wallet.connected ? 'awaiting signature' : 'connect wallet'}</b></span>
            <span>Wallet: <b className="text-teal">{lamportsToSol(walletBalance)} SOL</b></span>
            <span>Available collateral: <b className="text-cyan">{baseUnitsToUsdc(availableBalance)} USDC</b></span>
          </div>
          {(error || transactionState) && <div className="mt-3 text-sm text-gray-300">{error ?? transactionState}</div>}
        </section>

        <section id="markets" className="px-6 max-w-7xl mx-auto pb-10 grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_320px] gap-5">
          <aside className="card p-4">
            <h2 className="font-semibold mb-3">Live markets</h2>
            <div className="space-y-2 max-h-[65vh] overflow-y-auto">
              {markets.map((market) => <button key={market.address} onClick={() => setSelectedMarket(market)} className={`w-full p-3 rounded-lg text-left ${activeMarket?.address === market.address ? 'bg-teal/15 border border-teal/40' : 'bg-navy/60 hover:bg-white/5'}`}>
                <div className="flex justify-between gap-2"><span className="font-medium text-sm truncate">{market.title}</span><Status value={market.status} /></div>
                <div className="text-xs text-gray-400 mt-1">{market.marketType} · {market.status === 'OPEN' ? `${timeRemaining(market.expiresAt)} left` : market.status}</div>
              </button>)}
              {markets.length === 0 && <p className="text-sm text-gray-500 py-4">Waiting for the relayer’s live market feed.</p>}
            </div>
          </aside>

          <main className="space-y-5 min-w-0">
            {activeMarket ? <>
              <div className="card p-5"><div className="flex flex-wrap justify-between gap-3 mb-4"><div><h2 className="text-xl font-bold">{activeMarket.title}</h2><p className="text-sm text-gray-400">{activeMarket.marketType} · fixture {activeMarket.fixtureId} · fill #{activeMarket.fillSequence ?? '0'} · {timeRemaining(activeMarket.expiresAt)} remaining</p></div><Status value={activeMarket.status} /></div>
                <div className="flex gap-2 overflow-x-auto">{activeMarket.outcomeNames.map((name, index) => <button key={name} onClick={() => setOutcomeIndex(index)} className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap ${outcomeIndex === index ? 'bg-teal text-white' : 'bg-white/5 text-gray-300'}`}>{name}</button>)}</div>
              </div>
              <div className="card p-5"><h3 className="font-semibold mb-3">Depth book · {activeMarket.outcomeNames[outcomeIndex]}</h3><div className="grid grid-cols-2 gap-5 text-sm"><div><div className="text-xs text-teal mb-2">BIDS</div>{(book?.bids ?? []).slice(0, 8).map((level) => <div key={`${level.priceBps}-${level.quantity}`} className="flex justify-between py-1"><span className="text-teal">{(level.priceBps / 100).toFixed(0)}¢</span><span>{level.quantity}</span></div>) || null}{!book?.bids.length && <div className="text-gray-500">No bids</div>}</div><div><div className="text-xs text-cyan mb-2">ASKS</div>{(book?.asks ?? []).slice(0, 8).map((level) => <div key={`${level.priceBps}-${level.quantity}`} className="flex justify-between py-1"><span className="text-cyan">{(level.priceBps / 100).toFixed(0)}¢</span><span>{level.quantity}</span></div>) || null}{!book?.asks.length && <div className="text-gray-500">No asks</div>}</div></div></div>
              <div className="card p-5"><h3 className="font-semibold mb-3">Limit order</h3><div className="grid grid-cols-2 gap-2 mb-3">{(['BUY', 'SELL'] as OrderSide[]).map((nextSide) => <button key={nextSide} onClick={() => setSide(nextSide)} className={`rounded p-2 text-sm font-semibold ${side === nextSide ? nextSide === 'BUY' ? 'bg-teal text-white' : 'bg-cyan text-white' : 'bg-white/5 text-gray-300'}`}>{nextSide} {activeMarket.outcomeNames[outcomeIndex]}</button>)}</div><div className="grid grid-cols-2 gap-3"><label className="text-xs text-gray-400">Price (bps)<input value={priceBps} onChange={(event) => setPriceBps(event.target.value)} inputMode="numeric" className="mt-1 w-full rounded bg-navy border border-white/10 px-3 py-2 text-white" /></label><label className="text-xs text-gray-400">Shares<input value={orderAmount} onChange={(event) => setOrderAmount(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded bg-navy border border-white/10 px-3 py-2 text-white" /></label></div><div className="mt-3 flex justify-between text-xs text-gray-400"><span>Estimated {side === 'BUY' ? 'cost' : 'proceeds'}: {baseUnitsToUsdc(orderPreview.cost)} USDC</span><span>Max payout: {baseUnitsToUsdc(orderPreview.quantity)} USDC</span></div>{activeMarket.outcomeNames.length !== 2 && <p className="mt-3 text-xs text-yellow-300">Trading is temporarily limited to binary YES/NO markets.</p>}<button disabled={!wallet.connected || activeMarket.status !== 'OPEN' || activeMarket.outcomeNames.length !== 2 || orderPreview.quantity === 0n} onClick={() => void submit()} className="w-full btn-primary text-sm mt-4 disabled:opacity-50">{wallet.connected ? `Sign ${side.toLowerCase()} limit order` : 'Connect wallet to trade'}</button></div>
            </> : <div className="card p-8 text-gray-400">No CLOB market is currently open.</div>}
          </main>

          <aside className="space-y-5"><div className="card p-4"><h3 className="font-semibold mb-3">USDC collateral</h3><label className="text-xs text-gray-400">Deposit USDC<input value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded bg-navy border border-white/10 px-3 py-2 text-white" /></label><button disabled={!client} onClick={() => void runTransaction('Deposit', () => client!.deposit(usdcToBaseUnits(depositAmount)))} className="w-full btn-primary text-sm mt-2 disabled:opacity-50">Deposit</button><label className="block text-xs text-gray-400 mt-4">Withdraw USDC<input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded bg-navy border border-white/10 px-3 py-2 text-white" /></label><button disabled={!client} onClick={() => void runTransaction('Withdrawal', async () => { await cancelAllOpenOrders(); return client!.withdraw(usdcToBaseUnits(withdrawAmount)); })} className="w-full btn-secondary text-sm mt-2 disabled:opacity-50">Cancel orders & withdraw</button></div>
          <div id="portfolio" className="card p-4"><h3 className="font-semibold mb-3">Open orders</h3><div className="space-y-2 max-h-44 overflow-y-auto">{orders.filter((order) => order.status === 'OPEN' || order.status === 'PARTIAL').map((order) => <div key={order.id} className="rounded bg-white/5 p-2 text-xs"><div className="flex justify-between"><span>{order.side} · {order.priceBps / 100}¢</span><button onClick={() => void cancelOrder(order.id)} className="text-red-300">Cancel</button></div><div className="text-gray-400">{order.remainingQuantity}/{order.quantity} shares · <Status value={order.settlementStatus ?? order.status} /></div></div>)}{!orders.some((order) => order.status === 'OPEN' || order.status === 'PARTIAL') && <p className="text-sm text-gray-500">No open orders.</p>}</div></div>
          <div className="card p-4"><h3 className="font-semibold mb-3">Positions & claims</h3><div className="space-y-2 max-h-44 overflow-y-auto">{positions.map((position) => <div key={position.market} className="rounded bg-white/5 p-2 text-xs"><div className="flex justify-between"><span className="truncate">{position.marketTitle ?? position.market}</span><Status value={position.status} /></div><div className="text-gray-400 mt-1">{position.outcomeNames.map((name, index) => `${name}: ${position.shares[index] ?? '0'}`).join(' · ')}</div>{(position.status === 'RESOLVED' || position.status === 'VOIDED') && client && <button onClick={() => void runTransaction('Claim', () => client.claim(position.market))} className="text-teal mt-2">Claim position</button>}</div>)}{positions.length === 0 && <p className="text-sm text-gray-500">No positions yet.</p>}</div></div>
          <div className="card p-4"><h3 className="font-semibold mb-2">Recent fills</h3>{fills.slice(0, 5).map((fill) => <div key={fill.id} className="text-xs py-1 flex justify-between"><span>{fill.quantity} @ {fill.priceBps / 100}¢</span><Status value={fill.status} /></div>)}{fills.length === 0 && <p className="text-sm text-gray-500">No fills yet.</p>}</div></aside>
        </section>
      </div>
  );
}
