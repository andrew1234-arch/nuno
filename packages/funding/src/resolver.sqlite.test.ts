import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { AddressBook, sqliteSchema as s, txBytes, type RpcClient } from "@nuno/shared";
import { openLocal } from "@nuno/shared/node";
import { MAX_FUNDING_ATTEMPTS, pendingBuyers, resolveFundingTree } from "./resolver.js";

// Hand-built test fixtures (not real chain data): a fake archive node.
const W = "0x00000000000000000000000000000000000000e1" as Address; // buyer
const F = "0x00000000000000000000000000000000000000f1" as Address; // its funder
const D = "0x00000000000000000000000000000000000000d1" as Address; // disperse contract
const O = "0x00000000000000000000000000000000000000a1" as Address; // operator behind the disperse
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

// First block each address was funded at (balance > 0 from then on).
const FUNDED_AT: Record<string, number> = { [W]: 500, [F]: 200, [O]: 0 };
const hex = (n: number | bigint) => `0x${n.toString(16)}`;

function fakeArchive(failing = new Set<string>()) {
  return {
    async call(method: string, params: unknown[]) {
      const addr = (params[0] as string)?.toLowerCase?.();
      if (failing.has(addr)) throw new Error("boom");
      switch (method) {
        case "eth_getCode":
          return "0x";
        case "eth_getBalance":
        case "eth_getTransactionCount": {
          const at = FUNDED_AT[addr];
          return hex(at !== undefined && Number(params[1]) >= at ? 1 : 0);
        }
        case "eth_getBlockByNumber": {
          const b = Number(params[0]);
          // Block 500: direct transfer F -> W. Block 200: nothing top-level (internal send).
          const txs = b === 500 ? [{ hash: tx(500), from: F, to: W, value: "0x10" }] : [];
          return { number: hex(b), timestamp: hex(1_700_000_000 + b), transactions: txs };
        }
        case "debug_traceBlockByNumber":
          // Block 200: O calls disperse D, which sends to F.
          return [{ txHash: tx(200), result: { type: "CALL", from: O, to: D, value: "0x5", calls: [{ type: "CALL", from: D, to: F, value: "0x5" }] } }];
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  } as unknown as RpcClient;
}

describe("funding resolver on SQLite", () => {
  it("resolves first funding over hops and stores edges by address id", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    await resolveFundingTree({ db, book, rpc: fakeArchive() }, W, 1000, 3);

    const edges = await db.select().from(s.fundingEdges);
    const byWallet = new Map(edges.map((e) => [e.wallet, e]));
    const w = byWallet.get(await book.id(W))!;
    expect(w.origin).toBe(await book.id(F));
    expect(w.kind).toBe(s.FUNDING_KIND.native_direct);
    expect(w.block).toBe(500);
    const f = byWallet.get(await book.id(F))!;
    expect(f.funder).toBe(await book.id(D)); // value came from the disperse contract
    expect(f.origin).toBe(await book.id(O)); // linked on the signer
    expect(f.kind).toBe(s.FUNDING_KIND.native_internal);
    // O was first touched at block 0 with no inbound frame -> resolved without edges.
    const walletRows = await db.select().from(s.wallets);
    expect(walletRows.every((r) => r.fundingStatus === s.FUNDING_STATUS.resolved)).toBe(true);
    close();
  });

  it("caps failed attempts and puts never-tried wallets first", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    const tok = await book.id("0x00000000000000000000000000000000000000aa");
    const bad = "0x00000000000000000000000000000000000000bb" as Address;
    const fresh = "0x00000000000000000000000000000000000000cc" as Address;
    const ids = await book.ids([bad, fresh]);
    // `bad` bought first, `fresh` later.
    await db.insert(s.curveTrades).values([
      { tx: txBytes(tx(1)), logIndex: 0, block: 10, token: tok, trader: ids.get(bad)!, side: s.SIDE.buy, amountIn: "1", amountOut: "1" },
      { tx: txBytes(tx(2)), logIndex: 0, block: 20, token: tok, trader: ids.get(fresh)!, side: s.SIDE.buy, amountIn: "1", amountOut: "1" },
    ]);
    const rpc = fakeArchive(new Set([bad]));
    await resolveFundingTree({ db, book, rpc }, bad, 9, 1);
    expect((await pendingBuyers({ db, book }, 10)).map((b) => b.trader)).toEqual([fresh, bad]);
    for (let i = 1; i < MAX_FUNDING_ATTEMPTS; i++) await resolveFundingTree({ db, book, rpc }, bad, 9, 1);
    expect((await pendingBuyers({ db, book }, 10)).map((b) => b.trader)).toEqual([fresh]);
    close();
  });
});
