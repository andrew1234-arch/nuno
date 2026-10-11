import { describe, expect, it } from "vitest";
import type { RpcClient } from "@nuno/shared";
import { resolveFirstFunding } from "./resolver.js";

const WALLET = "0x00000000000000000000000000000000000000aa";
const FUNDED_AT = 1_000_050;

/** Fake RPC: wallet funded at FUNDED_AT by a top-level transfer; records the blocks it was asked about. */
function fake(name: string, seen: Array<[string, string, number]>): RpcClient {
  return {
    call: async (method: string, params: unknown[]) => {
      const block = Number(params[params.length - 1] as string);
      seen.push([name, method, block]);
      if (method === "eth_getCode") return "0x";
      if (method === "eth_getBalance") return block >= FUNDED_AT ? "0x1" : "0x0";
      if (method === "eth_getTransactionCount") return "0x0";
      if (method === "eth_getBlockByNumber")
        return { number: params[0], timestamp: "0x1", transactions: [{ hash: `0x${"1".repeat(64)}`, from: `0x${"b".repeat(40)}`, to: WALLET, value: "0x1" }] };
      throw new Error(`unexpected ${method}`);
    },
  } as unknown as RpcClient;
}

describe("recent-state routing", () => {
  it("reads state at recent blocks from the recent RPC and older state from the archive RPC; same result", async () => {
    const seen: Array<[string, string, number]> = [];
    const archive = fake("archive", seen);
    const recent = { rpc: fake("recent", seen), fromBlock: 1_000_000 };
    const r = await resolveFirstFunding(archive, WALLET, 1_000_100, recent);
    expect(r).toMatchObject({ status: "resolved", block: FUNDED_AT });
    const state = seen.filter(([, m]) => m !== "eth_getBlockByNumber");
    expect(state.length).toBeGreaterThan(0);
    for (const [who, , block] of state) expect(who).toBe(block >= 1_000_000 ? "recent" : "archive");
    // Block bodies (and traces) always come from the archive RPC.
    expect(seen.filter(([, m]) => m === "eth_getBlockByNumber").every(([who]) => who === "archive")).toBe(true);
    // Without recent endpoints everything goes to the archive RPC and the answer is identical.
    const only: Array<[string, string, number]> = [];
    expect(await resolveFirstFunding(fake("archive", only), WALLET, 1_000_100)).toEqual(r);
  });
});
