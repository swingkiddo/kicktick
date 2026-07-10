import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { Fill, FillStatus, MarketRecord, OrderStatus, StoredOrder } from "./types";

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS markets (
    market TEXT PRIMARY KEY, fixture_id TEXT NOT NULL, market_type TEXT NOT NULL, market_seq TEXT NOT NULL,
    outcome_count INTEGER NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL,
    chain_fill_sequence TEXT NOT NULL DEFAULT '0', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, market TEXT NOT NULL REFERENCES markets(market), owner TEXT NOT NULL, signature TEXT NOT NULL,
    version INTEGER NOT NULL, network TEXT NOT NULL, program_id TEXT NOT NULL, side TEXT NOT NULL,
    outcome_index INTEGER NOT NULL, price_bps INTEGER NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL,
    original_quantity TEXT NOT NULL, remaining_quantity TEXT NOT NULL, pending_quantity TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL, priority_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS orders_owner_nonce ON orders(owner, nonce);
  CREATE INDEX IF NOT EXISTS orders_book ON orders(market, outcome_index, side, status, price_bps, priority_at);
  CREATE TABLE IF NOT EXISTS fills (
    id TEXT PRIMARY KEY, market TEXT NOT NULL REFERENCES markets(market), market_sequence TEXT NOT NULL,
    kind TEXT NOT NULL, maker_order_ids TEXT NOT NULL, taker_order_ids TEXT NOT NULL,
    buyer TEXT, seller TEXT, outcome_index INTEGER, prices_bps TEXT NOT NULL, quantity TEXT NOT NULL,
    status TEXT NOT NULL, tx_signature TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS fills_market_sequence ON fills(market, market_sequence);
  CREATE INDEX IF NOT EXISTS fills_pending ON fills(status, market);
  CREATE TABLE IF NOT EXISTS nonces (
    owner TEXT NOT NULL, nonce TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(owner, nonce)
  );`,
];

type Row = Record<string, unknown>;
const bigint = (value: unknown): bigint => BigInt(String(value));
const number = (value: unknown): number => Number(value);

function asOrder(row: Row): StoredOrder {
  const payload = JSON.parse(String(row.payload_json)) as StoredOrder;
  return {
    ...payload, id: String(row.id), signature: String(row.signature),
    original_quantity: bigint(row.original_quantity), remaining_quantity: bigint(row.remaining_quantity),
    pending_quantity: bigint(row.pending_quantity), status: String(row.status) as OrderStatus,
    priority_at: number(row.priority_at), created_at: number(row.created_at), updated_at: number(row.updated_at),
  };
}

function asFill(row: Row): Fill {
  return {
    id: String(row.id), market: String(row.market), market_sequence: bigint(row.market_sequence),
    kind: String(row.kind) as Fill["kind"], maker_order_ids: JSON.parse(String(row.maker_order_ids)),
    taker_order_ids: JSON.parse(String(row.taker_order_ids)), buyer: row.buyer ? String(row.buyer) : undefined,
    seller: row.seller ? String(row.seller) : undefined, outcome_index: row.outcome_index === null ? undefined : number(row.outcome_index),
    prices_bps: JSON.parse(String(row.prices_bps)), quantity: bigint(row.quantity), status: String(row.status) as FillStatus,
    tx_signature: row.tx_signature ? String(row.tx_signature) : undefined, error: row.error ? String(row.error) : undefined,
    created_at: number(row.created_at), updated_at: number(row.updated_at),
  };
}

function asMarket(row: Row): MarketRecord {
  return {
    market: String(row.market), fixture_id: String(row.fixture_id), market_type: String(row.market_type), market_seq: String(row.market_seq),
    outcome_count: number(row.outcome_count), expires_at: number(row.expires_at), state: String(row.state) as MarketRecord["state"],
    chain_fill_sequence: bigint(row.chain_fill_sequence), created_at: number(row.created_at), updated_at: number(row.updated_at),
  };
}

/** SQLite is the durable source of order reservations. Quantity fields intentionally remain TEXT to avoid JS number loss. */
export class ClobStore {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  close(): void { this.db.close(); }

  clearForTest(): void {
    this.db.transaction(() => {
      this.db.exec("DELETE FROM fills; DELETE FROM orders; DELETE FROM nonces; DELETE FROM markets;");
    })();
  }

  private migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
    for (let index = 0; index < MIGRATIONS.length; index++) {
      const version = index + 1;
      if (this.db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version)) continue;
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[index]);
        this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, Date.now());
      })();
    }
  }

  upsertMarket(market: Omit<MarketRecord, "chain_fill_sequence" | "created_at" | "updated_at"> & { chain_fill_sequence?: bigint }): void {
    const now = Date.now();
    this.db.prepare(`INSERT INTO markets (market,fixture_id,market_type,market_seq,outcome_count,expires_at,state,chain_fill_sequence,created_at,updated_at)
      VALUES (@market,@fixture_id,@market_type,@market_seq,@outcome_count,@expires_at,@state,@chain_fill_sequence,@now,@now)
      ON CONFLICT(market) DO UPDATE SET fixture_id=excluded.fixture_id, market_type=excluded.market_type, market_seq=excluded.market_seq,
      outcome_count=excluded.outcome_count, expires_at=excluded.expires_at, state=excluded.state, updated_at=excluded.updated_at`).run({
      ...market, chain_fill_sequence: String(market.chain_fill_sequence ?? 0n), now,
    });
  }

  getMarket(market: string): MarketRecord | undefined {
    const row = this.db.prepare("SELECT * FROM markets WHERE market = ?").get(market) as Row | undefined;
    return row ? asMarket(row) : undefined;
  }

  listMarkets(states?: MarketRecord["state"][]): MarketRecord[] {
    const rows = states?.length
      ? this.db.prepare(`SELECT * FROM markets WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY expires_at`).all(...states)
      : this.db.prepare("SELECT * FROM markets ORDER BY expires_at").all();
    return (rows as Row[]).map(asMarket);
  }

  insertOrder(order: StoredOrder): void {
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO nonces(owner,nonce,kind,created_at) VALUES (?,?,?,?)").run(order.owner, order.nonce, "ORDER", Date.now());
      this.db.prepare(`INSERT INTO orders (id,market,owner,signature,version,network,program_id,side,outcome_index,price_bps,nonce,expires_at,original_quantity,remaining_quantity,pending_quantity,status,priority_at,created_at,updated_at,payload_json)
        VALUES (@id,@market,@owner,@signature,@version,@network,@program_id,@side,@outcome_index,@price_bps,@nonce,@expires_at,@original_quantity,@remaining_quantity,@pending_quantity,@status,@priority_at,@created_at,@updated_at,@payload_json)`).run({
        ...order, original_quantity: String(order.original_quantity), remaining_quantity: String(order.remaining_quantity), pending_quantity: String(order.pending_quantity), payload_json: JSON.stringify({
          version: order.version, network: order.network, program_id: order.program_id, market: order.market, owner: order.owner, side: order.side,
          outcome_index: order.outcome_index, price_bps: order.price_bps, quantity: order.quantity, nonce: order.nonce, expires_at: order.expires_at,
        }),
      });
    })();
  }

  getOrder(id: string): StoredOrder | undefined {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as Row | undefined;
    return row ? asOrder(row) : undefined;
  }

  listOpenOrders(market?: string): StoredOrder[] {
    const query = market
      ? this.db.prepare("SELECT * FROM orders WHERE market = ? AND status IN ('OPEN','PARTIAL') ORDER BY priority_at, id")
      : this.db.prepare("SELECT * FROM orders WHERE status IN ('OPEN','PARTIAL') ORDER BY priority_at, id");
    const rows = (market ? query.all(market) : query.all()) as Row[];
    return rows.map(asOrder);
  }

  listOwnerOrders(owner: string, market?: string): StoredOrder[] {
    const rows = market
      ? this.db.prepare("SELECT * FROM orders WHERE owner = ? AND market = ? ORDER BY created_at DESC").all(owner, market)
      : this.db.prepare("SELECT * FROM orders WHERE owner = ? ORDER BY created_at DESC").all(owner);
    return (rows as Row[]).map(asOrder);
  }

  cancelOrder(id: string, owner?: string, status: OrderStatus = "CANCELLED"): boolean {
    const result = owner
      ? this.db.prepare("UPDATE orders SET status=?, pending_quantity='0', updated_at=? WHERE id=? AND owner=? AND status IN ('OPEN','PARTIAL')").run(status, Date.now(), id, owner)
      : this.db.prepare("UPDATE orders SET status=?, pending_quantity='0', updated_at=? WHERE id=? AND status IN ('OPEN','PARTIAL')").run(status, Date.now(), id);
    return result.changes === 1;
  }

  consumeNonce(owner: string, nonce: string, kind: "CANCELLATION"): void {
    this.db.prepare("INSERT INTO nonces(owner,nonce,kind,created_at) VALUES (?,?,?,?)").run(owner, nonce, kind, Date.now());
  }

  expireOrders(nowSeconds: number): string[] {
    const rows = this.db.prepare("SELECT id FROM orders WHERE status IN ('OPEN','PARTIAL') AND expires_at <= ?").all(nowSeconds) as { id: string }[];
    const update = this.db.prepare("UPDATE orders SET status='EXPIRED', pending_quantity='0', updated_at=? WHERE id=?");
    this.db.transaction(() => rows.forEach(({ id }) => update.run(Date.now(), id)))();
    return rows.map(row => row.id);
  }

  /** Atomically reserves order quantities and records a durable fill before chain submission. */
  reserveFill(fill: Fill, quantities: ReadonlyMap<string, bigint>): void {
    this.db.transaction(() => {
      for (const [id, quantity] of quantities) {
        const order = this.getOrder(id);
        if (!order || !["OPEN", "PARTIAL"].includes(order.status) || order.remaining_quantity - order.pending_quantity < quantity) throw new Error(`cannot reserve order ${id}`);
        this.db.prepare("UPDATE orders SET pending_quantity=?, updated_at=? WHERE id=?").run(String(order.pending_quantity + quantity), Date.now(), id);
      }
      this.db.prepare(`INSERT INTO fills (id,market,market_sequence,kind,maker_order_ids,taker_order_ids,buyer,seller,outcome_index,prices_bps,quantity,status,created_at,updated_at)
        VALUES (@id,@market,@market_sequence,@kind,@maker_order_ids,@taker_order_ids,@buyer,@seller,@outcome_index,@prices_bps,@quantity,@status,@created_at,@updated_at)`).run({
        ...fill, market_sequence: String(fill.market_sequence), maker_order_ids: JSON.stringify(fill.maker_order_ids), taker_order_ids: JSON.stringify(fill.taker_order_ids),
        prices_bps: JSON.stringify(fill.prices_bps), quantity: String(fill.quantity), buyer: fill.buyer ?? null, seller: fill.seller ?? null,
        outcome_index: fill.outcome_index ?? null,
      });
    })();
  }

  markFillSubmitted(id: string, signature: string): void { this.updateFill(id, "SUBMITTED", signature); }
  markFillFailed(id: string, error: string): void { this.updateFill(id, "FAILED", undefined, error); }

  confirmFill(id: string): void {
    this.db.transaction(() => {
      const fill = this.getFill(id);
      if (!fill || fill.status === "CONFIRMED") return;
      const ids = [...fill.maker_order_ids, ...fill.taker_order_ids];
      const uniqueIds = [...new Set(ids)];
      for (const orderId of uniqueIds) {
        const row = this.getOrder(orderId);
        if (!row) throw new Error(`fill ${id} refers to missing order ${orderId}`);
        const next = row.remaining_quantity - fill.quantity;
        if (next < 0n) throw new Error(`fill ${id} exceeds remaining quantity for ${orderId}`);
        const pending = row.pending_quantity >= fill.quantity ? row.pending_quantity - fill.quantity : 0n;
        this.db.prepare("UPDATE orders SET remaining_quantity=?, pending_quantity=?, status=?, updated_at=? WHERE id=?").run(
          String(next), String(pending), next === 0n ? "FILLED" : "PARTIAL", Date.now(), orderId,
        );
      }
      this.updateFill(id, "CONFIRMED");
      this.db.prepare("UPDATE markets SET chain_fill_sequence = CAST(chain_fill_sequence AS INTEGER) + 1, updated_at=? WHERE market=?").run(Date.now(), fill.market);
    })();
  }

  releaseFill(id: string, error: string): void {
    this.db.transaction(() => {
      const fill = this.getFill(id);
      if (!fill || fill.status === "CONFIRMED") return;
      for (const orderId of new Set([...fill.maker_order_ids, ...fill.taker_order_ids])) {
        const order = this.getOrder(orderId);
        if (order) this.db.prepare("UPDATE orders SET pending_quantity=?, updated_at=? WHERE id=?").run(String(order.pending_quantity >= fill.quantity ? order.pending_quantity - fill.quantity : 0n), Date.now(), orderId);
      }
      this.updateFill(id, "FAILED", undefined, error);
    })();
  }

  getFill(id: string): Fill | undefined {
    const row = this.db.prepare("SELECT * FROM fills WHERE id=?").get(id) as Row | undefined;
    return row ? asFill(row) : undefined;
  }

  listPendingFills(): Fill[] {
    return (this.db.prepare("SELECT * FROM fills WHERE status IN ('MATCHED','SUBMITTED') ORDER BY market, market_sequence").all() as Row[]).map(asFill);
  }

  /** Allocates sequences after already-reserved fills, not only after confirmed fills. */
  nextFillSequence(market: string, confirmedSequence: bigint): bigint {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM fills WHERE market=? AND status IN ('MATCHED','SUBMITTED')").get(market) as { count: number };
    return confirmedSequence + BigInt(row.count);
  }

  private updateFill(id: string, status: FillStatus, txSignature?: string, error?: string): void {
    this.db.prepare("UPDATE fills SET status=?, tx_signature=COALESCE(?,tx_signature), error=COALESCE(?,error), updated_at=? WHERE id=?").run(status, txSignature ?? null, error ?? null, Date.now(), id);
  }
}
