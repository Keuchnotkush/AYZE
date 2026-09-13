import { describe, expect, it } from "vitest";
import {
  ayzeFeeOf,
  buildSchedule,
  defaultGrace,
  firstLossOf,
  interestOf,
  protectionOf,
  splitInterest,
  TERMS,
  TICKET,
  validateTerms,
} from "../economics";

describe("AYZE economics on the 1 000 XRP ticket", () => {
  it("derives the fixed amounts in drops", () => {
    expect(TICKET).toBe(1_000_000_000n);
    expect(interestOf(TICKET)).toBe(60_000_000n); // 6 %
    expect(ayzeFeeOf(TICKET)).toBe(5_000_000n); // 0.5 %
    expect(firstLossOf(TICKET)).toBe(700_000_000n); // 70 %
    expect(protectionOf(TICKET)).toBe(400_000_000n); // 40 %
  });

  it("splits interest 50 / 30 / 20 with the rounding remainder to lenders", () => {
    expect(splitInterest(60_000_000n)).toEqual({ protectionSeller: 30_000_000n, broker: 18_000_000n, lender: 12_000_000n });
    const odd = splitInterest(7n); // 3 / 2 / 2 → remainder lands on the lender share
    expect(odd.protectionSeller + odd.broker + odd.lender).toBe(7n);
    expect(odd).toEqual({ protectionSeller: 3n, broker: 2n, lender: 2n });
  });
});

describe("schedule", () => {
  it("builds N equal instalments from StartDate that sum to principal and interest", () => {
    const start = 800_000_000;
    const s = buildSchedule(TICKET, start, { paymentTotal: 3, paymentInterval: 120 });
    expect(s.map((i) => i.index)).toEqual([1, 2, 3]);
    expect(s.map((i) => i.dueDate)).toEqual([start + 120, start + 240, start + 360]);
    expect(s.reduce((a, i) => a + i.principal, 0n)).toBe(TICKET);
    expect(s.reduce((a, i) => a + i.interest, 0n)).toBe(60_000_000n);
    expect(s[2].principal).toBe(333_333_334n); // remainder on the last instalment
  });
});

describe("terms and grace", () => {
  it("validates against the XLS-66 bounds", () => {
    expect(validateTerms({ paymentTotal: 3, paymentInterval: 60 })).toBeNull();
    expect(validateTerms({ paymentTotal: 0, paymentInterval: 60 })).toMatch(/Instalments/);
    expect(validateTerms({ paymentTotal: TERMS.maxInstalments + 1, paymentInterval: 60 })).toMatch(/Instalments/);
    expect(validateTerms({ paymentTotal: 2, paymentInterval: 59 })).toMatch(/Interval/);
    expect(validateTerms({ paymentTotal: 2.5, paymentInterval: 60 })).toMatch(/Instalments/);
  });

  it("grace is 10 % of duration, clamped to [60 s, interval]", () => {
    expect(defaultGrace({ paymentTotal: 3, paymentInterval: 120 })).toBe(60); // 36 s → floor 60
    expect(defaultGrace({ paymentTotal: 12, paymentInterval: 600 })).toBe(600); // 720 s → capped at interval
    expect(defaultGrace({ paymentTotal: 4, paymentInterval: 300 })).toBe(120); // 10 % of 1 200
  });
});
