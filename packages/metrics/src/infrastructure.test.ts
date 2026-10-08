import { describe, expect, it } from "vitest";
import { isExchangeLike } from "./infrastructure.js";

describe("isExchangeLike", () => {
  // Profiles observed on Monad mainnet 2026-10-08 (see docs/VALIDATION.md).
  it("flags high-throughput wallets", () => {
    expect(isExchangeLike(73_554, 378_069_331)).toBe(true); // 0xf89d…
    expect(isExchangeLike(578_677, 8_391_738)).toBe(true); // 0xf70d…
    expect(isExchangeLike(7_594, 3)).toBe(true); // 0xa934… distributor
  });
  it("flags very large balances even with few txs", () => {
    expect(isExchangeLike(587, 42_717_843)).toBe(true); // 0x9322…
  });
  it("does not flag a small private operator wallet", () => {
    expect(isExchangeLike(91, 1_096)).toBe(false); // 0xb245…, the serial-launch funder
    expect(isExchangeLike(701, 751_341)).toBe(false);
  });
});
