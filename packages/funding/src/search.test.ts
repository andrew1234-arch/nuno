import { describe, expect, it } from "vitest";
import { firstTrueBlock } from "./search.js";

const after = (n: number) => async (b: number) => b >= n;

describe("firstTrueBlock", () => {
  it("finds the first block where the predicate turns true", async () => {
    expect(await firstTrueBlock(0, 1_000_000, after(123_457))).toBe(123_457);
  });

  it("returns lo when already true at lo", async () => {
    expect(await firstTrueBlock(10, 20, after(0))).toBe(10);
  });

  it("returns hi when it only turns true at hi", async () => {
    expect(await firstTrueBlock(10, 20, after(20))).toBe(20);
  });

  it("returns null when never true in range", async () => {
    expect(await firstTrueBlock(0, 100, after(101))).toBeNull();
  });

  it("returns null for an empty range", async () => {
    expect(await firstTrueBlock(5, 4, after(0))).toBeNull();
  });

  it("uses O(log n) predicate calls", async () => {
    let calls = 0;
    await firstTrueBlock(0, 111_000_000, async (b) => {
      calls++;
      return b >= 77_777_777;
    });
    expect(calls).toBeLessThanOrEqual(29);
  });
});
