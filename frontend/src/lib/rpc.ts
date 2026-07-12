import { Connection, type Commitment } from '@solana/web3.js';

const MIN_REQUEST_INTERVAL_MS = 350;
let queue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;

function schedule<T>(request: () => Promise<T>): Promise<T> {
  const result = queue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
    return request();
  });
  queue = result.catch(() => undefined);
  return result;
}

/** Shared request queue for public RPC endpoints. */
export function createRpcConnection(endpoint: string, commitment: Commitment = 'confirmed'): Connection {
  const connection = new Connection(endpoint, commitment);
  const rpcRequest = (connection as any)._rpcRequest.bind(connection) as (...args: any[]) => Promise<any>;
  (connection as any)._rpcRequest = (...args: any[]) => schedule(() => rpcRequest(...args));
  return connection;
}
