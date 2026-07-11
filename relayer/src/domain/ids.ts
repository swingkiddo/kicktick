/** Numeric identifiers retain their runtime representation while documenting units at boundaries. */
export type FixtureId = number;
export type MarketSequence = number;
export type TxLineSequence = number;
export type UnixSeconds = number;
export type UnixMilliseconds = number;
export type StatKey = number;
export type StatPeriod = number;

function finiteInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function asFixtureId(value: number): FixtureId {
  return finiteInteger(value, "fixture id");
}

export function asMarketSequence(value: number): MarketSequence {
  return finiteInteger(value, "market sequence");
}

export function asTxLineSequence(value: number): TxLineSequence {
  return finiteInteger(value, "TxLINE sequence");
}

export function asUnixSeconds(value: number): UnixSeconds {
  return finiteInteger(value, "Unix timestamp");
}

export function asStatKey(value: number): StatKey {
  return finiteInteger(value, "stat key");
}

export function asStatPeriod(value: number): StatPeriod {
  return finiteInteger(value, "stat period");
}

export function parseFixtureId(value: string): FixtureId {
  return asFixtureId(Number(value));
}

export function serializeFixtureId(value: FixtureId): string {
  return String(asFixtureId(value));
}

export function parseMarketSequence(value: string): MarketSequence {
  return asMarketSequence(Number(value));
}

export function serializeMarketSequence(value: MarketSequence): string {
  return String(asMarketSequence(value));
}

export function u64ToLeBytes(value: number | bigint, label = "u64 value"): Buffer {
  const integer = typeof value === "bigint" ? value : BigInt(finiteInteger(value, label));
  if (integer < 0n || integer > 18_446_744_073_709_551_615n) {
    throw new Error(`${label} must fit in an unsigned 64-bit integer`);
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(integer);
  return bytes;
}
