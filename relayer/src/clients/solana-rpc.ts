/**
 * Shared HTTP transport for Solana RPC calls.
 *
 * Devnet rate-limits bursts with HTTP 429.  A shared queue is important here:
 * AnchorClient and the runtime status/recovery checks otherwise create
 * independent Connection instances and can still burst concurrently.
 */

const MIN_INTERVAL_MS = Math.max(
  0,
  Number.parseInt(process.env.SOLANA_RPC_MIN_INTERVAL_MS || "750", 10) || 750,
);
const MAX_RATE_LIMIT_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
  }

  return Math.min(30_000, 1000 * 2 ** attempt);
}

class SolanaRpcTransport {
  private tail: Promise<void> = Promise.resolve();
  private lastStartedAt = 0;

  fetch: typeof fetch = (input, init) => {
    const request = this.tail.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const elapsed = Date.now() - this.lastStartedAt;
        if (elapsed < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - elapsed);
        this.lastStartedAt = Date.now();

        const response = await fetch(input, init);
        if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) {
          return response;
        }

        await response.body?.cancel();
        await sleep(retryAfterMs(response, attempt));
      }
    });

    // Keep the queue usable after a failed network request.
    this.tail = request.then(() => undefined, () => undefined);
    return request;
  };
}

export const solanaRpcFetch = new SolanaRpcTransport().fetch;

