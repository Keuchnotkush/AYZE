import { describe, expect, it } from "vitest";
import { bps, dropsToXrp, fromXRPL, splitEven, splitProRata, toXRPL, xrpToDrops } from "../amounts";

describe("xrpToDrops / dropsToXrp", () => {
  it("round-trips whole and fractional XRP", () => {
    expect(xrpToDrops("1000")).toBe(1_000_000_000n);
    expect(xrpToDrops("0.5")).toBe(500_000n);
    expect(xrpToDrops(12.25)).toBe(12_250_000n);
    expect(dropsToXrp(1_000_000_000n)).toBe("1000");
    expect(dropsToXrp(12n)).toBe("0.000012");
    expect(dropsToXrp(-1_500_000n)).toBe("-1.5");
  });
  it("truncates beyond 6 decimals instead of rounding", () => {
    expect(xrpToDrops("0.1234567")).toBe(123_456n);
  });
});

describe("fromXRPL (STNumber fields)", () => {
  it("accepts plain drops, decimals and exponent notation", () => {
    expect(fromXRPL("1000000000")).toBe(1_000_000_000n);
    expect(fromXRPL("1000000000.0")).toBe(1_000_000_000n);
    expect(fromXRPL("1.5e9")).toBe(1_500_000_000n);
    expect(fromXRPL("333.3358701198967648e6")).toBe(333_335_870n);
    expect(fromXRPL(undefined)).toBe(0n);
  });
  it("rounds down and keeps the sign", () => {
    expect(fromXRPL("-2.9")).toBe(-2n);
    expect(() => fromXRPL("abc")).toThrow();
  });
});

describe("toXRPL", () => {
  it("serialises drops as a decimal string and refuses negatives", () => {
    expect(toXRPL(5_000_000n)).toBe("5000000");
    expect(() => toXRPL(-1n)).toThrow();
  });
});

describe("splits", () => {
  it("splitEven sums exactly and puts the remainder last", () => {
    const parts = splitEven(1_000_000_000n, 3);
    expect(parts).toEqual([333_333_333n, 333_333_333n, 333_333_334n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(1_000_000_000n);
    expect(splitEven(10n, 0)).toEqual([]);
  });
  it("splitProRata follows weights, sums exactly, remainder to the largest weight", () => {
    const parts = splitProRata(100n, [1n, 1n, 1n]);
    expect(parts).toEqual([34n, 33n, 33n]);
    expect(splitProRata(100n, [3n, 1n])).toEqual([75n, 25n]);
    expect(splitProRata(100n, [0n, 0n])).toEqual([0n, 0n]);
    expect(splitProRata(100n, [])).toEqual([]);
  });
  it("bps is exact integer arithmetic", () => {
    expect(bps(1_000_000_000n, 600n)).toBe(60_000_000n);
    expect(bps(1_000_000_000n, 50n)).toBe(5_000_000n);
    expect(bps(1n, 1n)).toBe(0n);
  });
});
