import { describe, expect, it } from "vitest";
import type { BlockTraceEntry, RpcBlock } from "@nuno/shared";
import { directTransfersFromBlock, extractInboundTransfers } from "./trace.js";

// Hand-built test fixtures (not real chain data).
const W = "0x00000000000000000000000000000000000000aa";
const EOA = "0x00000000000000000000000000000000000000e0";
const DISPERSE = "0x00000000000000000000000000000000000000d1";
const OTHER = "0x00000000000000000000000000000000000000bb";

describe("extractInboundTransfers", () => {
  it("finds a direct top-level send", () => {
    const traces: BlockTraceEntry[] = [
      { txHash: "0x01", result: { type: "CALL", from: EOA, to: W, value: "0xde0b6b3a7640000" } },
    ];
    expect(extractInboundTransfers(traces, W)).toEqual([
      { txHash: "0x01", funder: EOA, origin: EOA, value: 10n ** 18n, kind: "native_direct" },
    ]);
  });

  it("finds internal sends from a disperse contract and keeps the tx signer as origin", () => {
    const traces: BlockTraceEntry[] = [
      {
        txHash: "0x02",
        result: {
          type: "CALL",
          from: EOA,
          to: DISPERSE,
          value: "0x3",
          calls: [
            { type: "CALL", from: DISPERSE, to: OTHER, value: "0x1" },
            { type: "CALL", from: DISPERSE, to: W, value: "0x2" },
          ],
        },
      },
    ];
    expect(extractInboundTransfers(traces, W)).toEqual([
      { txHash: "0x02", funder: DISPERSE, origin: EOA, value: 2n, kind: "native_internal" },
    ]);
  });

  it("ignores reverted frames and everything beneath them", () => {
    const traces: BlockTraceEntry[] = [
      {
        txHash: "0x03",
        result: {
          type: "CALL",
          from: EOA,
          to: DISPERSE,
          value: "0x0",
          calls: [
            { type: "CALL", from: DISPERSE, to: W, value: "0x5", error: "execution reverted" },
            {
              type: "CALL",
              from: DISPERSE,
              to: OTHER,
              error: "execution reverted",
              calls: [{ type: "CALL", from: OTHER, to: W, value: "0x7" }],
            },
          ],
        },
      },
    ];
    expect(extractInboundTransfers(traces, W)).toEqual([]);
  });

  it("ignores zero-value calls and STATICCALL/DELEGATECALL frames", () => {
    const traces: BlockTraceEntry[] = [
      {
        txHash: "0x04",
        result: {
          type: "CALL",
          from: EOA,
          to: W,
          value: "0x0",
          calls: [{ type: "DELEGATECALL", from: OTHER, to: W, value: "0x9" }],
        },
      },
    ];
    expect(extractInboundTransfers(traces, W)).toEqual([]);
  });

  it("matches addresses case-insensitively and lowercases output", () => {
    const traces: BlockTraceEntry[] = [
      { txHash: "0xAB", result: { type: "CALL", from: "0x00000000000000000000000000000000000000E0", to: "0x00000000000000000000000000000000000000AA", value: "0x1" } },
    ];
    const out = extractInboundTransfers(traces, W);
    expect(out[0]).toMatchObject({ txHash: "0xab", funder: EOA, origin: EOA });
  });
});

describe("directTransfersFromBlock", () => {
  it("returns only top-level value sends to the wallet", () => {
    const block: RpcBlock = {
      number: "0x10",
      timestamp: "0x1",
      transactions: [
        { hash: "0x01", from: EOA, to: W, value: "0x5" },
        { hash: "0x02", from: EOA, to: W, value: "0x0" },
        { hash: "0x03", from: EOA, to: OTHER, value: "0x5" },
        { hash: "0x04", from: EOA, to: null, value: "0x5" },
      ],
    };
    expect(directTransfersFromBlock(block, W)).toEqual([
      { txHash: "0x01", funder: EOA, origin: EOA, value: 5n, kind: "native_direct" },
    ]);
  });
});
