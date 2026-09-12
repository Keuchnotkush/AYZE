/**
 * Money is handled as micro-USD (1 USD = 1_000_000) in bigint so that bps
 * splits never touch floating point. Only the boundary with the ledger
 * converts to/from XRPL decimal strings.
 */
export type Micro = bigint;

export const MICRO = 1_000_000n;
export const BPS = 10_000n;

export const usd = (value: number | string): Micro => {
  const [whole, frac = ""] = String(value).split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  const sign = whole.startsWith("-") ? -1n : 1n;
  return sign * (BigInt(whole.replace("-", "") || "0") * MICRO + BigInt(fracPadded));
};

/** Micro-USD → XRPL IOU value string ("1234.5"), trailing zeros trimmed. */
export function toXRPL(amount: Micro): string {
  if (amount < 0n) throw new Error(`Negative amount: ${amount}`);
  const whole = amount / MICRO;
  const frac = (amount % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** XRPL decimal string (any precision) → micro-USD, rounded down. */
export function fromXRPL(value: string | number | undefined | null): Micro {
  if (value === undefined || value === null) return 0n;
  const s = String(value);
  if (/e/i.test(s)) return usd(Number(s).toFixed(6));
  return usd(s);
}

export const bps = (amount: Micro, rate: bigint): Micro => (amount * rate) / BPS;

/** Number for display only. */
export const toNumber = (amount: Micro): number => Number(amount) / 1_000_000;

/**
 * Splits `total` into `parts` integers that sum exactly to `total`;
 * the rounding remainder goes to the last part.
 */
export function splitEven(total: Micro, parts: number): Micro[] {
  if (parts <= 0) return [];
  const base = total / BigInt(parts);
  const out = Array.from({ length: parts }, () => base);
  out[parts - 1] += total - base * BigInt(parts);
  return out;
}

/** Splits `total` proportionally to `weights`; remainder goes to the largest weight. */
export function splitProRata(total: Micro, weights: bigint[]): Micro[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n || weights.length === 0) return weights.map(() => 0n);
  const out = weights.map((w) => (total * w) / sum);
  const remainder = total - out.reduce((a, b) => a + b, 0n);
  const largest = weights.indexOf(weights.reduce((a, b) => (b > a ? b : a), weights[0]));
  out[largest] += remainder;
  return out;
}
