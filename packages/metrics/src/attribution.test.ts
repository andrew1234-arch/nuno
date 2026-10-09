import { describe, expect, it } from "vitest";
import { effectiveTrader, swapAsTrade } from "./attribution.js";

// Hand-built test fixtures (not real chain data).
const BOT = "0xb07";
const EOA = "0xe0a";

describe("effectiveTrader", () => {
  it("keeps an EOA sender", () => {
    expect(effectiveTrader(EOA, EOA, new Set([BOT]))).toBe(EOA);
  });
  it("attributes a contract sender's trade to the tx signer", () => {
    expect(effectiveTrader(BOT, EOA, new Set([BOT]))).toBe(EOA);
  });
  it("keeps the contract when the signer is unknown", () => {
    expect(effectiveTrader(BOT, null, new Set([BOT]))).toBe(BOT);
  });
  it("never attributes to another contract", () => {
    expect(effectiveTrader(BOT, "0xc0", new Set([BOT, "0xc0"]))).toBe(BOT);
  });
});

describe("swapAsTrade (Uniswap V3 token/WMON pool)", () => {
  const LOW = "0x1000000000000000000000000000000000000000";
  const HIGH = "0xf000000000000000000000000000000000000000";
  it("token is token0: pool sends tokens and receives MON -> buy", () => {
    expect(swapAsTrade({ amount0: -500n, amount1: 7n }, LOW, HIGH)).toEqual({ side: "buy", mon: 7n, tokens: 500n });
  });
  it("token is token0: pool receives tokens and sends MON -> sell", () => {
    expect(swapAsTrade({ amount0: 500n, amount1: -6n }, LOW, HIGH)).toEqual({ side: "sell", mon: 6n, tokens: 500n });
  });
  it("token is token1 (address above WMON): sides read from amount1", () => {
    expect(swapAsTrade({ amount0: 7n, amount1: -500n }, HIGH, LOW)).toEqual({ side: "buy", mon: 7n, tokens: 500n });
    expect(swapAsTrade({ amount0: -6n, amount1: 500n }, HIGH, LOW)).toEqual({ side: "sell", mon: 6n, tokens: 500n });
  });
  it("ignores degenerate swaps", () => {
    expect(swapAsTrade({ amount0: 0n, amount1: 5n }, LOW, HIGH)).toBeNull();
  });
});
