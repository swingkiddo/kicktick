import { useEffect, useMemo, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useTestWallets } from '@/lib/TestWalletContext';
import { useClob } from '@/lib/ClobProvider';
import { KicktickClient, ReadonlyKicktickClient, baseUnitsToUsdc, usdcToBaseUnits } from '@/lib/kicktickClient';
import type { ReadonlyConfig, ReadonlyMarket, ReadonlyUser } from '@/lib/kicktickClient';
import type { ClobMarket } from '@/lib/clobTypes';
import { useWs } from './WebSocketProvider';

const reader = new ReadonlyKicktickClient();
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const statusNames = ['OPEN', 'LOCKED', 'RESOLVED_PENDING', 'RESOLVED', 'VOIDED'];
const marketTypes = [
  'NextGoalSide', 'GoalInWindow', 'NextCorner', 'CornerInWindow',
  'NextYellowCard', 'YellowCardInWindow', 'RedCardInMatch',
  'PenaltyShootoutShot', 'PenaltyShot', 'VARCheck',
];

interface AdminMatch {
  fixtureId: number;
  status: string;
  homeScore: number;
  awayScore: number;
}

export default function AdminTrading() {
  if (!import.meta.env.DEV) return <div className="card p-6 text-amber-300">The trading panel is available only in a Vite dev build.</div>;
  return <DevTradingPanel />;
}

function DevTradingPanel() {
  const { wallets, selected, select, loading: walletsLoading, error: walletsError } = useTestWallets();
  const { connected, authenticated, markets, books, orders, fills, subscribeOrderbook, submitOrder } = useClob();
  const { messages, isConnected: adminConnected, testAuthenticated, createTestMatch, createTestMarket, emitTestEvent, snapshotTest } = useWs();
  const [config, setConfig] = useState<ReadonlyConfig>();
  const [chainMarket, setChainMarket] = useState<ReadonlyMarket>();
  const [user, setUser] = useState<ReadonlyUser>();
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<bigint>();
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [marketFixtureId, setMarketFixtureId] = useState('');
  const [selectedMarket, setSelectedMarket] = useState('');
  const [outcome, setOutcome] = useState(0);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [pricePercent, setPricePercent] = useState('50');
  const [quantity, setQuantity] = useState('1');
  const [message, setMessage] = useState('');
  const [claimMessage, setClaimMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [fixtureId, setFixtureId] = useState(String(Date.now()));
  const [homeTeam, setHomeTeam] = useState('Home FC');
  const [awayTeam, setAwayTeam] = useState('Away FC');
  const [marketType, setMarketType] = useState('VARCheck');
  const [marketSeq, setMarketSeq] = useState('1');
  const [deadlineSeconds, setDeadlineSeconds] = useState('120');
  const [managementMessage, setManagementMessage] = useState('');
  const [walletActionBusy, setWalletActionBusy] = useState(false);
  const [depositAmount, setDepositAmount] = useState('10');
  const [userAccountState, setUserAccountState] = useState<'idle' | 'checking' | 'exists' | 'missing' | 'error'>('idle');

  const latestSnapshot = useMemo(() => [...messages].reverse().find(item => item.type === 'test_snapshot'), [messages]);

  const matches = useMemo<AdminMatch[]>(() => {
    const byFixture = new Map<number, AdminMatch>();
    for (const item of latestSnapshot?.data?.matches ?? []) {
      const id = Number(item.fixtureId);
      if (Number.isSafeInteger(id)) byFixture.set(id, { fixtureId: id, status: String(item.status ?? 'NS'), homeScore: Number(item.homeScore ?? 0), awayScore: Number(item.awayScore ?? 0) });
    }
    for (const item of messages) {
      if (item.type !== 'match_state') continue;
      byFixture.set(item.data.fixtureId, { fixtureId: item.data.fixtureId, status: item.data.status, homeScore: item.data.homeScore, awayScore: item.data.awayScore });
    }
    return [...byFixture.values()].sort((a, b) => a.fixtureId - b.fixtureId);
  }, [latestSnapshot, messages]);

  const snapshotMarkets: ClobMarket[] = useMemo(() => (latestSnapshot?.data?.markets ?? []).map((item: any) => ({
    address: String(item.market), fixtureId: String(item.fixture_id), marketType: String(item.market_type), marketSeq: String(item.market_seq), title: String(item.market_type), expiresAt: Number(item.expires_at), outcomeNames: Array.from({ length: Number(item.outcome_count ?? 2) }, (_unused: unknown, index: number) => `Outcome ${index + 1}`), status: String(item.state ?? 'OPEN').toUpperCase() as ClobMarket['status'], fillSequence: String(item.chain_fill_sequence ?? 0),
  })), [latestSnapshot]);

  const availableMarkets = useMemo(() => {
    const byAddress = new Map<string, ClobMarket>();
    for (const market of [...snapshotMarkets, ...markets]) byAddress.set(market.address, market);
    return [...byAddress.values()];
  }, [markets, snapshotMarkets]);
  const marketsForSelectedMatch = useMemo(() => selectedMatchId ? availableMarkets.filter(item => item.fixtureId === selectedMatchId) : [], [availableMarkets, selectedMatchId]);
  const market = availableMarkets.find(item => item.address === selectedMarket);
  const book = selectedMarket ? books[`${selectedMarket}:${outcome}`] : undefined;
  const walletOrders = orders.filter(order => !selected || order.owner === selected.publicKey.toBase58());
  const walletFills = fills.filter(fill => fill.market === selectedMarket);
  const adminReady = adminConnected && testAuthenticated;
  const selectedClient = useMemo(() => selected ? new KicktickClient(selected) : undefined, [selected]);

  const refresh = async () => {
    try {
      setConfig(await reader.config());
      if (selectedMarket) setChainMarket(await reader.market(selectedMarket));
      else { setChainMarket(undefined); setUser(undefined); }
      if (selected) {
        setUserAccountState('checking');
        const [nextWalletUsdc, nextUser] = await Promise.all([reader.usdcBalance(selected.publicKey), reader.user(selected.publicKey, selectedMarket ? new PublicKey(selectedMarket) : undefined)]);
        setWalletUsdcBalance(nextWalletUsdc);
        setUser(nextUser);
        setUserAccountState(nextUser ? 'exists' : 'missing');
      } else setWalletUsdcBalance(undefined);
    } catch (error) { setUserAccountState('error'); setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const createUserAccount = async () => {
    if (!selectedClient) return;
    setWalletActionBusy(true); setMessage('Creating UserAccount…');
    try {
      const signature = await selectedClient.initUser();
      setMessage(`UserAccount created: ${signature.slice(0, 12)}…`);
      setUserAccountState('exists');
      reader.clearUserCache(selected?.publicKey);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setWalletActionBusy(false); }
  };

  const depositToSelectedWallet = async () => {
    if (!selectedClient) return;
    setWalletActionBusy(true); setMessage('Depositing USDC…');
    try {
      const signature = await selectedClient.deposit(usdcToBaseUnits(depositAmount));
      setMessage(`Deposit confirmed: ${signature.slice(0, 12)}…`);
      setUserAccountState('exists');
      reader.clearUserCache(selected?.publicKey);
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setWalletActionBusy(false); }
  };

  const claimSelectedWallet = async () => {
    if (!selectedClient || !selectedMarket) { setClaimMessage('Choose a wallet and market first.'); return; }
    if (!chainMarket) { setClaimMessage('Selected market chain state is not loaded yet.'); return; }
    if (chainMarket.status !== 3 && chainMarket.status !== 4) { setClaimMessage('The selected market is not resolved or voided yet.'); return; }
    if (!user) { setClaimMessage('Selected wallet has no UserAccount or position for this market.'); return; }
    if (user.claimed) { setClaimMessage('This wallet has already claimed this market.'); return; }
    setWalletActionBusy(true); setClaimMessage('Claiming position…'); setMessage('Claiming position…');
    try {
      const signature = await selectedClient.claim(selectedMarket);
      setClaimMessage(`Claim confirmed: ${signature.slice(0, 12)}…`); setMessage(`Claim confirmed: ${signature.slice(0, 12)}…`);
      reader.clearUserCache(selected?.publicKey);
      await refresh();
    } catch (error) { const text = error instanceof Error ? error.message : String(error); setClaimMessage(text); setMessage(text); }
    finally { setWalletActionBusy(false); }
  };

  useEffect(() => { void refresh(); }, [selected, selectedMarket]);
  useEffect(() => { if (selectedMarket) subscribeOrderbook(selectedMarket, outcome); }, [outcome, selectedMarket, subscribeOrderbook]);
  useEffect(() => { if (adminConnected) snapshotTest(); }, [adminConnected, snapshotTest]);

  const orderQuantity = useMemo(() => {
    try { return usdcToBaseUnits(quantity).toString(); } catch { return ''; }
  }, [quantity]);
  const estimatedCost = useMemo(() => { try { return (BigInt(orderQuantity || '0') * BigInt(pricePercent || '0') * 100n + 9_999n) / 10_000n; } catch { return 0n; } }, [orderQuantity, pricePercent]);
  const displayShares = orderQuantity ? baseUnitsToUsdc(orderQuantity) : '—';
  const quantityTooSmall = !orderQuantity || (() => { try { return BigInt(orderQuantity) < 100n; } catch { return true; } })();
  const custodyMismatch = user !== undefined && user.availableBalance + user.reservedBalance > user.vaultBalance;
  const testError = [...messages].reverse().find(item => item.type === 'test_error') as { type: 'test_error'; data?: { message?: string } } | undefined;
  const latestTestResult = useMemo(() => [...messages].reverse().find(item => item.type === 'test_ack' || item.type === 'test_error') as { type: 'test_ack' | 'test_error'; data?: any } | undefined, [messages]);

  useEffect(() => {
    if (!latestTestResult) return;
    if (latestTestResult.type === 'test_error') { setManagementMessage(`Create failed: ${latestTestResult.data?.message ?? 'unknown relayer error'}`); return; }
    if (latestTestResult.data?.command === 'test_create_match') {
      const createdFixtureId = String(latestTestResult.data.fixtureId);
      setMarketFixtureId(createdFixtureId); setSelectedMatchId(createdFixtureId);
      setManagementMessage(`Match created: ${createdFixtureId} · tx ${latestTestResult.data.txSig ?? 'n/a'}`); snapshotTest();
    } else if (latestTestResult.data?.command === 'test_create_market') {
      const createdMarket = String(latestTestResult.data.market ?? '');
      const createdFixtureId = String(latestTestResult.data.fixtureId);
      setSelectedMatchId(createdFixtureId); setSelectedMarket(createdMarket);
      setManagementMessage(`Market created: ${createdMarket || 'n/a'} · tx ${latestTestResult.data.txSig ?? 'n/a'}`); snapshotTest();
    } else if (latestTestResult.data?.command === 'test_emit_event') {
      setManagementMessage(`VAR result sent for fixture ${latestTestResult.data.fixtureId}; relayer is locking and resolving the market.`);
      snapshotTest();
    }
  }, [latestTestResult, snapshotTest]);

  const addMatch = () => {
    const id = Number(fixtureId);
    if (!adminReady || !Number.isSafeInteger(id) || id <= 0 || !homeTeam.trim() || !awayTeam.trim()) { setManagementMessage('Connect the admin WebSocket and enter a positive fixture ID with both team names.'); return; }
    const sent = createTestMatch({ fixtureId: id, homeTeam: homeTeam.trim(), awayTeam: awayTeam.trim() });
    setManagementMessage(sent ? `Creating match ${id}…` : 'Cannot send: relayer WebSocket is not connected.');
  };
  const addMarket = () => {
    const id = Number(marketFixtureId); const seq = Number(marketSeq); const deadline = Number(deadlineSeconds);
    if (!adminReady || !Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(seq) || seq < 0 || !Number.isInteger(deadline) || deadline < 15 || deadline > 7200) { setManagementMessage('Select a match and set a valid sequence and deadline (15–7200 seconds).'); return; }
    createTestMarket({ fixtureId: id, marketType, marketSeq: seq, deadlineSeconds: deadline });
    setManagementMessage(`Creating ${marketType} for fixture ${id}…`);
  };
  const selectMatch = (fixture: string) => { setSelectedMatchId(fixture); setSelectedMarket(''); setOutcome(0); };
  const resolveSelectedVarCheckYes = () => {
    if (!adminReady || !market || market.marketType !== 'VARCheck' || market.status !== 'OPEN') {
      setManagementMessage('Choose an open VARCheck market and wait for the admin WebSocket.');
      return;
    }
    const id = Number(market.fixtureId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      setManagementMessage('The selected market has an invalid fixture ID.');
      return;
    }
    const sent = emitTestEvent({ fixtureId: id, action: 'var_end', outcome: 'Overturned' });
    setManagementMessage(sent ? `Sending VAR Overturned for fixture ${id}…` : 'Cannot send: relayer WebSocket is not connected.');
  };
  const placeOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || !market) return setMessage('Select a wallet and market first.');
    setBusy(true); setMessage('Creating on-chain order…');
    try {
      if (!orderQuantity) throw new Error('Enter a valid amount and price.');
      const nowUnixSeconds = Math.floor(Date.now() / 1000);
      console.group('[KickTick] create order market diagnostics');
      console.log({
        address: market.address,
        fixtureId: market.fixtureId,
        marketType: market.marketType,
        marketSeq: market.marketSeq,
        uiStatus: market.status,
        uiExpiresAt: market.expiresAt,
        uiExpiresAtIso: new Date(market.expiresAt * 1000).toISOString(),
        nowUnixSeconds,
        remainingSeconds: market.expiresAt - nowUnixSeconds,
        orderExpiresAt: market.expiresAt,
        chainMarket,
        chainExpiresAt: chainMarket?.expiresAt?.toString(),
        chainRemainingSeconds: chainMarket ? Number(chainMarket.expiresAt) - nowUnixSeconds : undefined,
      });
      console.groupEnd();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      setMessage('Submitting to CLOB…');
      if (!chainMarket) throw new Error('On-chain market state is unavailable. Refresh the selected market.');
      const chainExpiresAt = Number(chainMarket.expiresAt);
      if (!Number.isSafeInteger(chainExpiresAt) || chainExpiresAt <= nowUnixSeconds) throw new Error('Selected market deadline has passed on-chain.');
      const id = await submitOrder({ market: market.address, side, outcomeIndex: outcome, priceBps: Number(pricePercent) * 100, quantity: orderQuantity, expiresAt: Math.min(market.expiresAt, chainExpiresAt) });
      setMessage(`order_ack: ${id}`);
    }
    catch (error) { setMessage(`order_rejected: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Dev trading panel</h1><p className="text-xs text-amber-300 mt-1">Create test entities, choose a market and trade with local test wallets.</p></div><div className="flex items-center gap-3"><span className={`text-xs ${adminReady ? 'text-teal' : 'text-amber-300'}`}>{adminReady ? 'Admin feed connected' : 'Waiting for admin WebSocket…'}</span><button className="btn-secondary text-sm" onClick={() => void refresh()}>Refresh chain state</button></div></div>

    <section className="card p-4 border-teal/20"><div className="mb-4"><h2 className="font-semibold">Create match and market</h2><p className="text-xs text-gray-400 mt-1">Create a match first, then choose that match when creating its market.</p></div><div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="space-y-2"><h3 className="text-xs uppercase tracking-wide text-gray-400">1. Match</h3><input className="field w-full" type="number" value={fixtureId} onChange={e => setFixtureId(e.target.value)} placeholder="Fixture ID" /><div className="grid grid-cols-2 gap-2"><input className="field" value={homeTeam} onChange={e => setHomeTeam(e.target.value)} placeholder="Home team" /><input className="field" value={awayTeam} onChange={e => setAwayTeam(e.target.value)} placeholder="Away team" /></div><button className="btn-primary text-sm w-full" disabled={!adminReady} onClick={addMatch}>{adminReady ? 'Create match' : 'Waiting for admin WebSocket…'}</button></div>
      <div className="space-y-2"><h3 className="text-xs uppercase tracking-wide text-gray-400">2. Market</h3><select className="field w-full" value={marketFixtureId} onChange={e => setMarketFixtureId(e.target.value)}><option value="">Choose match</option>{matches.map(item => <option key={item.fixtureId} value={item.fixtureId}>#{item.fixtureId} · {item.status} · {item.homeScore}:{item.awayScore}</option>)}</select><div className="grid grid-cols-2 gap-2"><select className="field" value={marketType} onChange={e => setMarketType(e.target.value)}>{marketTypes.map(type => <option key={type}>{type}</option>)}</select><input className="field" type="number" min="0" value={marketSeq} onChange={e => setMarketSeq(e.target.value)} placeholder="Sequence" /></div><input className="field w-full" type="number" min="15" max="7200" value={deadlineSeconds} onChange={e => setDeadlineSeconds(e.target.value)} placeholder="Deadline seconds" /><button className="btn-primary text-sm w-full" disabled={!adminReady || !marketFixtureId} onClick={addMarket}>{adminReady ? 'Create market' : 'Waiting for admin WebSocket…'}</button></div>
    </div>{managementMessage && <div className="mt-3 text-xs text-amber-300">{managementMessage}</div>}{testError?.data?.message && <div className="mt-3 text-xs text-red-300">Test control error: {testError.data.message}</div>}</section>

    <section className="card p-4 border-teal/20"><div className="mb-4"><h2 className="font-semibold">Choose market</h2><p className="text-xs text-gray-400 mt-1">Select the current match first; the market list is then limited to that match.</p></div><div className="grid grid-cols-1 xl:grid-cols-3 gap-3"><select className="field" value={selectedMatchId} onChange={e => selectMatch(e.target.value)}><option value="">Choose current match</option>{matches.map(item => <option key={item.fixtureId} value={item.fixtureId}>#{item.fixtureId} · {item.status} · {item.homeScore}:{item.awayScore}</option>)}</select><select className="field xl:col-span-2" value={selectedMarket} onChange={e => { setSelectedMarket(e.target.value); setOutcome(0); }} disabled={!selectedMatchId}><option value="">Choose market</option>{marketsForSelectedMatch.map(item => <option key={item.address} value={item.address}>{item.title} · seq {item.marketSeq} · {short(item.address)}</option>)}</select></div></section>

    <section className="card p-4 border-teal/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Resolve test VARCheck</h2>
          <p className="text-xs text-gray-400 mt-1">Emits var_end / Overturned. The relayer drains fills, locks the selected market, and resolves outcome 0 (YES).</p>
        </div>
        <button
          className="btn-primary text-sm whitespace-nowrap"
          disabled={!adminReady || !market || market.marketType !== 'VARCheck' || market.status !== 'OPEN'}
          onClick={resolveSelectedVarCheckYes}
        >Resolve as YES</button>
      </div>
    </section>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4"><section className="card p-4 xl:col-span-2"><h2 className="font-semibold mb-3">Contract state</h2><div className="grid grid-cols-2 gap-3 text-xs"><div><span className="text-gray-400">RPC</span><div className="font-mono">{reader.connection.rpcEndpoint}</div></div><div><span className="text-gray-400">Program</span><div className="font-mono">{reader.programId.toBase58()}</div></div><div><span className="text-gray-400">Config admin</span><div className="font-mono">{config?.admin ? short(config.admin) : '—'}</div></div><div><span className="text-gray-400">Relayer</span><div className="font-mono">{config?.relayer ? short(config.relayer) : '—'}</div></div></div></section><section className="card p-4"><h2 className="font-semibold mb-3">Selected market</h2><div className="text-xs space-y-1">{chainMarket ? <><div>Status: <b>{statusNames[chainMarket.status] ?? chainMarket.status}</b></div><div>On-chain expiry: <b>{new Date(Number(chainMarket.expiresAt) * 1000).toISOString()}</b></div><div>Remaining: {Number(chainMarket.expiresAt) - Math.floor(Date.now() / 1000)} sec</div><div>Volume: {chainMarket.totalVolume.toString()} · fills: {chainMarket.fillSequence.toString()}</div><div>Open positions: {chainMarket.openPositions.toString()}</div><button className="btn-primary text-xs mt-3 w-full disabled:opacity-50" disabled={walletActionBusy} onClick={() => void claimSelectedWallet()}>{walletActionBusy ? 'Claiming…' : user?.claimed ? 'Claim again' : 'Claim'}</button>{claimMessage && <div className="mt-2 break-all text-amber-300">{claimMessage}</div>}</> : <div className="text-gray-400">Choose a market to inspect chain state.</div>}</div></section></div>

    <section className="card p-4"><div className="flex justify-between mb-3"><h2 className="font-semibold">Choose wallet</h2><span className="text-xs text-gray-400">{walletsLoading ? 'Loading keys…' : walletsError ?? 'USDC balance from chain'}</span></div><div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2">{wallets.map(wallet => <button key={wallet.name} onClick={() => select(wallet.publicKey.toBase58())} className={`text-left p-2 rounded border text-xs ${selected?.name === wallet.name ? 'border-teal bg-teal/10' : 'border-white/10 hover:border-white/30'}`}><div>{wallet.name}</div><div className="font-mono text-gray-400">{short(wallet.publicKey.toBase58())}</div></button>)}</div>{selected && <div className="mt-4 border-t border-white/10 pt-3 text-sm"><div><span className="text-teal">{selected.name}</span> · {short(selected.publicKey.toBase58())} <span className="ml-4 text-gray-400">wallet</span> {walletUsdcBalance !== undefined ? baseUnitsToUsdc(walletUsdcBalance) : '…'} USDC <span className="ml-4 text-gray-400">available</span> {user ? baseUnitsToUsdc(user.availableBalance) : '—'} USDC <span className="ml-4 text-gray-400">reserved</span> {user ? baseUnitsToUsdc(user.reservedBalance) : '—'} USDC <span className="ml-4 text-gray-400">vault</span> {user ? baseUnitsToUsdc(user.vaultBalance) : '—'} USDC</div>{custodyMismatch && <div className="mt-2 text-xs text-red-300">Collateral mismatch: available + reserved exceeds UserVault.</div>}<div className="mt-3 flex flex-wrap items-end gap-2"><span className={`text-xs ${userAccountState === 'exists' ? 'text-teal' : userAccountState === 'error' ? 'text-red-300' : 'text-amber-300'}`}>{userAccountState === 'checking' ? 'Checking UserAccount…' : userAccountState === 'exists' ? 'UserAccount exists' : userAccountState === 'error' ? 'UserAccount check failed' : 'UserAccount not found'}</span>{userAccountState !== 'exists' && <button className="btn-secondary text-xs" disabled={walletActionBusy || userAccountState === 'checking'} onClick={() => void createUserAccount()}>{walletActionBusy ? 'Creating…' : 'Create UserAccount'}</button>}<label className="text-xs text-gray-400">Deposit USDC<input className="field mt-1 w-28" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} inputMode="decimal" /></label><button className="btn-primary text-xs" disabled={walletActionBusy || userAccountState === 'checking'} onClick={() => void depositToSelectedWallet()}>{walletActionBusy ? 'Processing…' : 'Deposit'}</button></div>{message && <div className="mt-3 text-xs break-all text-gray-300">{message}</div>}</div>}</section>

    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4"><section className="card p-4"><h2 className="font-semibold mb-3">Orderbook {market ? `· ${market.title}` : ''}</h2>{market && <div className="flex gap-2 mb-3">{market.outcomeNames.map((name, index) => <button key={name} onClick={() => setOutcome(index)} className={`px-3 py-1 rounded text-xs ${outcome === index ? 'bg-teal text-black' : 'bg-white/5'}`}>{name}</button>)}</div>}<div className="grid grid-cols-2 gap-4 text-xs"><div><div className="text-teal mb-2">Bids</div>{book?.bids.map((level, i) => <div key={i} className="flex justify-between"><span>{(level.priceBps / 100).toFixed(0)}%</span><span>{baseUnitsToUsdc(level.quantity)}</span></div>)}</div><div><div className="text-red-300 mb-2">Asks</div>{book?.asks.map((level, i) => <div key={i} className="flex justify-between"><span>{(level.priceBps / 100).toFixed(0)}%</span><span>{baseUnitsToUsdc(level.quantity)}</span></div>)}</div></div></section><section className="card p-4"><h2 className="font-semibold mb-3">Place order</h2><form onSubmit={placeOrder} className="space-y-3 text-sm"><div className="flex gap-2">{(['BUY', 'SELL'] as const).map(value => <button type="button" key={value} onClick={() => setSide(value)} className={`flex-1 py-2 rounded ${side === value ? value === 'BUY' ? 'bg-teal text-black' : 'bg-red-400 text-black' : 'bg-white/5'}`}>{value}</button>)}</div><div className="grid grid-cols-3 gap-2"><label>Outcome<select className="field" value={outcome} onChange={e => setOutcome(Number(e.target.value))}>{(market?.outcomeNames ?? ['Yes', 'No']).map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label><label>Price (%)<input className="field" type="number" min="1" max="99" step="1" value={pricePercent} onChange={e => setPricePercent(e.target.value)} /></label><label>Shares<input className="field" type="number" min="0.000001" step="0.000001" value={quantity} onChange={e => setQuantity(e.target.value)} /></label></div><div className="text-xs text-gray-400">Estimated {side === 'BUY' ? 'cost' : 'proceeds'}: <span className="text-white">{baseUnitsToUsdc(estimatedCost)} USDC</span> · {displayShares} shares</div>{quantityTooSmall && <div className="text-xs text-amber-300">Minimum order: 0.0001 shares.</div>}<button className="btn-primary w-full" disabled={busy || quantityTooSmall || !authenticated || !connected || !selected || !market}>{busy ? 'Signing…' : authenticated ? 'Sign and submit' : 'Waiting for CLOB auth…'}</button></form><div className="mt-3 text-xs font-mono break-all text-gray-300">{message}</div><div className="mt-3 text-xs text-gray-400">Open orders: {walletOrders.filter(order => order.status === 'OPEN' || order.status === 'PARTIAL').length} · fills: {walletFills.length}</div></section></div>
  </div>;
}
