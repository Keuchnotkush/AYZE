/**
 * Money is native XRP handled in drops (1 XRP = 1_000_000 drops) as bigint so
 * that bps splits never touch floating point. The ledger speaks drops directly,
 * so the boundary conversion is a plain string; XRP is only used for display.
 */
export type Drops = bigint;

export const DROPS_PER_XRP = 1_000_000n;
export const BPS = 10_000n;

/** Decimal XRP ("1000", "0.5", 12.25) → drops. Beyond 6 decimals is truncated. */
export const xrpToDrops = (value: number | string): Drops => {
  const [whole, frac = ""] = String(value).split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  const sign = whole.startsWith("-") ? -1n : 1n;
  return sign * (BigInt(whole.replace("-", "") || "0") * DROPS_PER_XRP + BigInt(fracPadded));
};

/** Drops → decimal XRP string ("1000", "0.000012"), up to 6 decimals, trailing zeros trimmed. */
export function dropsToXrp(amount: Drops): string {
  const sign = amount < 0n ? "-" : "";
  const abs = amount < 0n ? -amount : amount;
  const whole = abs / DROPS_PER_XRP;
  const frac = (abs % DROPS_PER_XRP).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

/** Drops → XRPL `Amount` for native XRP: the drops as a decimal string. */
export function toXRPL(amount: Drops): string {
  if (amount < 0n) throw new Error(`Negative amount: ${amount}`);
  return amount.toString();
}

/**
 * Ledger number (drops: "1000000000", possibly "1.5e9" or "1000000000.0" from
 * STNumber fields such as AssetsTotal / DebtTotal / PrincipalOutstanding) → drops, rounded down.
 */
export function fromXRPL(value: string | number | undefined | null): Drops {
  if (value === undefined || value === null) return 0n;
  const s = String(value).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) throw new Error(`Unparseable ledger amount: ${s}`);
  const [, sign, int = "", frac = "", exp = "0"] = m;
  const digits = BigInt((int + frac) || "0");
  const scale = frac.length - Number(exp); // value = digits / 10^scale
  const abs = scale <= 0 ? digits * 10n ** BigInt(-scale) : digits / 10n ** BigInt(scale);
  return sign === "-" ? -abs : abs;
}

export const bps = (amount: Drops, rate: bigint): Drops => (amount * rate) / BPS;

/** XRP as a number, for display only. */
export const toNumber = (amount: Drops): number => Number(amount) / 1_000_000;

/**
 * Splits `total` into `parts` integers that sum exactly to `total`;
 * the rounding remainder goes to the last part.
 */
export function splitEven(total: Drops, parts: number): Drops[] {
  if (parts <= 0) return [];
  const base = total / BigInt(parts);
  const out = Array.from({ length: parts }, () => base);
  out[parts - 1] += total - base * BigInt(parts);
  return out;
}

/** Splits `total` proportionally to `weights`; remainder goes to the largest weight. */
export function splitProRata(total: Drops, weights: bigint[]): Drops[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n || weights.length === 0) return weights.map(() => 0n);
  const out = weights.map((w) => (total * w) / sum);
  const remainder = total - out.reduce((a, b) => a + b, 0n);
  const largest = weights.indexOf(weights.reduce((a, b) => (b > a ? b : a), weights[0]));
  out[largest] += remainder;
  return out;
}
