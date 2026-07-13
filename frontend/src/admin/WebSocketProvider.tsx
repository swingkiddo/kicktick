import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

export type WsServerMessage =
  | { type: "welcome"; data: { version: string } }
  | { type: "match_state"; data: { fixtureId: number; status: string; homeScore: number; awayScore: number; currentPeriod: string; matchClockMs: number } }
  | { type: "market_opened"; data: { fixtureId: number; marketSeq: number; marketType: string; lockSeconds: number; deadlineSeconds: number; expiresAt: number } }
  | { type: "market_resolved"; data: { fixtureId: number; marketSeq: number; outcome: string; txSig?: string } }
  | { type: "market_confirmed"; data: { fixtureId: number; marketSeq: number; txSig?: string } }
  | { type: "market_cancelled"; data: { fixtureId: number; marketSeq: number } }
  | { type: "football_event"; data: { action: string; fixtureId: number; participant?: number; description: string } }
  | { type: "tx_status"; data: { fixtureId: number; marketSeq: number; status: string; txSig?: string; error?: string } }
  | { type: "system_status"; data: { clientCount: number; uptime: number; activeFixtureCount: number; solBalance: number } }
  | { type: "error"; data: { message: string } }
  | { type: "error_log"; data: { message: string; timestamp: number; fixtureId?: number; marketSeq?: number } }
  | { type: "test_ack" | "test_error" | "test_snapshot"; data?: any };

interface WsContextValue {
  messages: WsServerMessage[];
  isConnected: boolean;
  subscribeMatch: (fixtureId: number) => void;
  unsubscribeMatch: (fixtureId: number) => void;
  subscribeAll: () => void;
  testAuthenticated: boolean;
  createTestMatch: (data: { fixtureId: number; homeTeam: string; awayTeam: string }) => boolean;
  createTestMarket: (data: { fixtureId: number; marketType: string; marketSeq: number; deadlineSeconds: number }) => boolean;
  emitTestEvent: (data: { fixtureId: number; action: string; participant?: number; statusId?: number; outcome?: string }) => void;
  resetTest: () => void;
  snapshotTest: () => void;
}

const WsContext = createContext<WsContextValue>({
  messages: [],
  isConnected: false,
  subscribeMatch: () => {},
  unsubscribeMatch: () => {},
  subscribeAll: () => {},
  testAuthenticated: false,
  createTestMatch: () => false, createTestMarket: () => false, emitTestEvent: () => false, resetTest: () => false, snapshotTest: () => false,
});

export function useWs() {
  return useContext(WsContext);
}

const WS_URL = (() => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_RELAYER_HOST) {
    return `ws://${(import.meta as any).env.VITE_RELAYER_HOST}`;
  }
  return 'ws://localhost:8080';
})();

const MAX_MESSAGES = 500;

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<WsServerMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [testAuthenticated, setTestAuthenticated] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingMessagesRef = useRef<object[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      const isCurrentSocket = () => wsRef.current === ws;

      ws.onopen = () => {
        if (!isCurrentSocket()) return;
        console.info('[TEST_WS] socket open', WS_URL);
        setIsConnected(true);
        // Test control-plane auth is intentionally disabled during the dev smoke test.
        // Re-enable the challenge flow when TEST_AUTH_REQUIRED is turned back on in the relayer.
        setTestAuthenticated(true);
        ws.send(JSON.stringify({ type: "subscribe_all" }));
        ws.send(JSON.stringify({ type: "test_snapshot" }));
        const pendingMessages = pendingMessagesRef.current.splice(0);
        for (const pendingMessage of pendingMessages) {
          try {
            ws.send(JSON.stringify(pendingMessage));
          } catch (error) {
            console.warn('[TEST_WS] queued send failed', { error, data: pendingMessage });
            pendingMessagesRef.current.unshift(pendingMessage);
            break;
          }
        }
      };

      ws.onmessage = (event) => {
        if (!isCurrentSocket()) return;
        try {
          const msg: WsServerMessage = JSON.parse(event.data);
          if ((msg as any).type === 'test_authenticated') { console.info('[TEST_AUTH] authenticated'); setTestAuthenticated(true); ws.send(JSON.stringify({ type: 'test_snapshot' })); }
          if ((msg as any).type === 'test_error') console.error('[TEST_AUTH] server error', (msg as any).data?.message);
          setMessages(prev => [...prev.slice(-(MAX_MESSAGES - 1)), msg]);
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!isCurrentSocket()) return;
        console.warn('[TEST_AUTH] socket closed');
        setIsConnected(false);
        setTestAuthenticated(false);
        wsRef.current = null;
        if (!cancelled) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        if (!isCurrentSocket()) return;
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      pendingMessagesRef.current = [];
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((data: object): boolean => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      console.info('[TEST_WS] send', data);
      try {
        ws.send(JSON.stringify(data));
        return true;
      } catch (error) {
        console.warn('[TEST_WS] send failed', { error, data });
      }
    }
    if (!ws || ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.CLOSING) {
      pendingMessagesRef.current.push(data);
      console.info('[TEST_WS] queued until socket is open', data);
      return true;
    }
    console.warn('[TEST_WS] send skipped: socket is not open', { readyState: ws?.readyState ?? 'missing', data });
    return false;
  }, []);

  const subscribeMatch = useCallback((fixtureId: number) => {
    send({ type: "subscribe_match", data: { fixtureId } });
  }, [send]);

  const unsubscribeMatch = useCallback((fixtureId: number) => {
    send({ type: "unsubscribe_match", data: { fixtureId } });
  }, [send]);

  const subscribeAll = useCallback(() => {
    send({ type: "subscribe_all" });
  }, [send]);

  const testCommand = useCallback((type: string, data?: unknown) => {
    const command = { type, ...(data === undefined ? {} : { data }) };
    console.info('[TEST_WS] command requested', command);
    return send(command);
  }, [send]);
  const createTestMatch = useCallback((data: { fixtureId: number; homeTeam: string; awayTeam: string }) => testCommand('test_create_match', data), [testCommand]);
  const createTestMarket = useCallback((data: { fixtureId: number; marketType: string; marketSeq: number; deadlineSeconds: number }) => testCommand('test_create_market', data), [testCommand]);
  const emitTestEvent = useCallback((data: { fixtureId: number; action: string; participant?: number; statusId?: number; outcome?: string }) => testCommand('test_emit_event', data), [testCommand]);
  const resetTest = useCallback(() => testCommand('test_reset'), [testCommand]);
  const snapshotTest = useCallback(() => testCommand('test_snapshot'), [testCommand]);

  return (
    <WsContext.Provider value={{ messages, isConnected, subscribeMatch, unsubscribeMatch, subscribeAll, testAuthenticated, createTestMatch, createTestMarket, emitTestEvent, resetTest, snapshotTest }}>
      {children}
    </WsContext.Provider>
  );
}
