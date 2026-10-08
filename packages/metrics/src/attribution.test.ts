import { describe, expect, it } from "vitest";
import { effectiveTrader } from "./attribution.js";

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
