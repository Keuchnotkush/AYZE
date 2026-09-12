const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

export const fmtUSD = (value: number) => `${usd.format(value)} USD`;
export const fmtPct = (fraction: number, digits = 1) => `${(fraction * 100).toFixed(digits)}%`;

/** Ripple epoch (2000-01-01) seconds → Date. */
export const rippleToDate = (seconds: number) => new Date((seconds + 946_684_800) * 1000);

export function fmtDate(rippleSeconds: number) {
  return rippleToDate(rippleSeconds).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function fmtDuration(seconds: number) {
  const abs = Math.abs(Math.round(seconds));
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const body = m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
  return seconds < 0 ? `${body} ago` : `in ${body}`;
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export const EXPLORER =
  process.env.NEXT_PUBLIC_XRPL_EXPLORER ??
  "https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233";

export const txUrl = (hash: string) => `${EXPLORER}/transactions/${hash}`;
export const accountUrl = (address: string) => `${EXPLORER}/accounts/${address}`;
