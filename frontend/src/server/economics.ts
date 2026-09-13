import { BPS, bps, splitEven, xrpToDrops, type Drops } from "./amounts";

/* AYZE economics, all rates in integer basis points. */

export const TICKET: Drops = xrpToDrops(1000); // 1 000 XRP, in drops
export const INTEREST_BPS = 600n; // 6 % flat over the life of the loan
export const AYZE_FEE_BPS = 50n; // 0.5 % of principal, paid to AYZE at origination
export const FIRST_LOSS_BPS = 7000n; // broker cover = 70 % of principal
export const PROTECTION_BPS = 4000n; // protection seller escrows = 40 % of principal

/** Share of each interest payment; sums to 10 000. */
export const INTEREST_SPLIT_BPS = { protectionSeller: 5000n, broker: 3000n, lender: 2000n } as const;

/** Ledger parameters for the per-loan LoanBroker (1/10 bps). */
export const COVER_RATE_MINIMUM = 70_000; // 70 %
export const COVER_RATE_LIQUIDATION = 100_000; // 100 % → cover absorbs exactly 70 % of remaining debt

/** Bounds enforced by XLS-66 on LoanSet. */
export const TERMS = { minInstalments: 1, maxInstalments: 12, minInterval: 60, minGrace: 60 } as const;

/** Seconds after `due + grace` during which the broker can still finish an escrow. */
export const CLAIM_WINDOW = 300;

export type Instalment = { index: number; dueDate: number; principal: Drops; interest: Drops };

/** Grace as a share of the total loan duration (paymentTotal × paymentInterval), in bps. */
export const DEFAULT_GRACE_BPS = 1000n; // 10 %

export type Terms = { paymentTotal: number; paymentInterval: number };

export function validateTerms(t: Terms): string | null {
  if (!Number.isInteger(t.paymentTotal) || t.paymentTotal < TERMS.minInstalments || t.paymentTotal > TERMS.maxInstalments)
    return `Instalments must be between ${TERMS.minInstalments} and ${TERMS.maxInstalments}.`;
  if (!Number.isInteger(t.paymentInterval) || t.paymentInterval < TERMS.minInterval)
    return `Interval must be at least ${TERMS.minInterval} seconds.`;
  return null;
}

/**
 * DEFAULT_GRACE = ceil(10 % × duration), clamped to the XLS-66 bounds [minGrace, interval]
 * so that `tfLoanDefault` is accepted as soon as the servicing loop fires.
 */
export function defaultGrace(t: Terms): number {
  const raw = Math.ceil((t.paymentTotal * t.paymentInterval * Number(DEFAULT_GRACE_BPS)) / Number(BPS));
  return Math.min(t.paymentInterval, Math.max(TERMS.minGrace, raw));
}

export const interestOf = (principal: Drops) => bps(principal, INTEREST_BPS);
export const ayzeFeeOf = (principal: Drops) => bps(principal, AYZE_FEE_BPS);
export const firstLossOf = (principal: Drops) => bps(principal, FIRST_LOSS_BPS);
export const protectionOf = (principal: Drops) => bps(principal, PROTECTION_BPS);

/** Repayment schedule: equal instalments from the ledger StartDate (ripple epoch seconds). */
export function buildSchedule(principal: Drops, startDate: number, terms: Terms): Instalment[] {
  const principals = splitEven(principal, terms.paymentTotal);
  const interests = splitEven(interestOf(principal), terms.paymentTotal);
  return principals.map((p, i) => ({
    index: i + 1,
    dueDate: startDate + terms.paymentInterval * (i + 1),
    principal: p,
    interest: interests[i],
  }));
}

export type InterestSplit = { protectionSeller: Drops; broker: Drops; lender: Drops };

/** Splits one instalment's interest; rounding remainder goes to the lender share. */
export function splitInterest(interest: Drops): InterestSplit {
  const protectionSeller = bps(interest, INTEREST_SPLIT_BPS.protectionSeller);
  const broker = bps(interest, INTEREST_SPLIT_BPS.broker);
  return { protectionSeller, broker, lender: interest - protectionSeller - broker };
}

/** Sanity: the split rates must add up to 100 %. */
if (INTEREST_SPLIT_BPS.protectionSeller + INTEREST_SPLIT_BPS.broker + INTEREST_SPLIT_BPS.lender !== BPS) {
  throw new Error("INTEREST_SPLIT_BPS must sum to 10 000");
}
