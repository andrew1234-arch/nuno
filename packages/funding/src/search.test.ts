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
    expect(calls).toBeLessThanOrEqual(29 + 14);
  });

  it("finds a recent first block in few calls (fresh wallet funded just before it spends)", async () => {
    let calls = 0;
    const r = await firstTrueBlock(0, 110_580_184, async (b) => {
      calls++;
      return b >= 110_580_143;
    });
    expect(r).toBe(110_580_143);
    expect(calls).toBeLessThanOrEqual(14);
  });

  it("matches a plain binary search for every first-true position", async () => {
    const plain = async (lo: number, hi: number, f: (b: number) => Promise<boolean>) => {
      if (lo > hi || !(await f(hi))) return null;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (await f(mid)) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    };
    for (const [lo, hi] of [[0, 300], [50, 9_000], [0, 20_000]] as const) {
      for (let n = lo - 2; n <= hi + 2; n += n < hi - 300 && n > lo + 300 ? 97 : 1) {
        expect(await firstTrueBlock(lo, hi, after(n))).toBe(await plain(lo, hi, after(n)));
      }
    }
  });
});
