import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { AddressBook, sqliteSchema as s, type RpcClient } from "@nuno/shared";
import { openLocal } from "@nuno/shared/node";
import { MAX_EDGES_PER_WALLET, resolveFundingTree, resolveLaterDeposits } from "./resolver.js";

// Hand-built test fixtures (not real chain data): a fake archive node with a balance history.
const MON = 10n ** 18n;
const W = "0x00000000000000000000000000000000000000e2" as Address; // seeder-like wallet
const SMALL = "0x00000000000000000000000000000000000000f2" as Address; // first, small funder
const BIG = "0x00000000000000000000000000000000000000f3" as Address; // later, large funder
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const hex = (n: number | bigint) => `0x${n.toString(16)}`;

/** W: +10 MON at block 100 (SMALL), +300 MON at block 700 (BIG). Funders funded at block 0 with nothing inbound. */
function archive(deposits: Array<{ block: number; from: Address; value: bigint }>, calls = { balance: 0 }) {
  const balanceOf = (addr: string, b: number) =>
    addr === W.toLowerCase() ? deposits.filter((d) => d.block <= b).reduce((a, d) => a + d.value, 0n) : b >= 0 ? 1n : 0n;
  return {
    calls,
    rpc: {
      async call(method: string, params: unknown[]) {
        const addr = (params[0] as string)?.toLowerCase?.();
        switch (method) {
          case "eth_getCode":
            return "0x";
          case "eth_getBalance":
            calls.balance++;
            return hex(balanceOf(addr, Number(params[1])));
          case "eth_getTransactionCount":
            return "0x0";
          case "eth_getBlockByNumber": {
            const b = Number(params[0]);
            const txs = deposits.filter((d) => d.block === b).map((d) => ({ hash: tx(b), from: d.from, to: W, value: hex(d.value) }));
            return { number: hex(b), timestamp: hex(1_700_000_000 + b), transactions: txs };
          }
          case "debug_traceBlockByNumber":
            return [];
          default:
            throw new Error(`unexpected ${method}`);
        }
      },
    } as unknown as RpcClient,
  };
}

describe("later deposits (≤5 inbound funding edges per wallet)", () => {
  it("captures a large top-up after a small first funding", async () => {
    const { rpc } = archive([
      { block: 100, from: SMALL, value: 10n * MON },
      { block: 700, from: BIG, value: 300n * MON },
    ]);
    const found = await resolveLaterDeposits(rpc, W, 100, 1000, 4);
    expect(found.map((d) => d.block)).toEqual([700]);
    expect(found[0]!.transfers[0]!.origin).toBe(BIG);
  });

  it("stores first funding + deposits as separate edges and follows the deposit's sender", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    const { rpc } = archive([
      { block: 100, from: SMALL, value: 10n * MON },
      { block: 700, from: BIG, value: 300n * MON },
    ]);
    await resolveFundingTree({ db, book, rpc }, W, 1000, 2);
    const edges = await db.select().from(s.fundingEdges).where(eq(s.fundingEdges.wallet, await book.id(W)));
    expect(edges.map((e) => [e.block, e.value]).sort()).toEqual([
      [100, (10n * MON).toString()],
      [700, (300n * MON).toString()],
    ]);
    // Hop 2 reached the large funder too.
    const big = await db.select().from(s.wallets).where(eq(s.wallets.id, await book.id(BIG)));
    expect(big[0]?.fundingStatus).toBe(s.FUNDING_STATUS.resolved);
    close();
  });

  it("searches already-resolved wallets once, then uses the marker", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    // First pass: only the small funding exists (as if resolved before deposits were searched).
    await resolveFundingTree({ db, book, rpc: archive([{ block: 100, from: SMALL, value: 10n * MON }]).rpc }, W, 1000, 1);
    await db.delete(s.cursors); // drop the marker: simulates a wallet resolved by the old resolver
    const later = archive([
      { block: 100, from: SMALL, value: 10n * MON },
      { block: 700, from: BIG, value: 300n * MON },
    ]);
    await resolveFundingTree({ db, book, rpc: later.rpc }, W, 1000, 1);
    expect((await db.select().from(s.fundingEdges)).map((e) => e.block).sort()).toEqual([100, 700]);
    const before = later.calls.balance;
    await resolveFundingTree({ db, book, rpc: later.rpc }, W, 1000, 1);
    expect(later.calls.balance).toBe(before); // marked: no second search
    close();
  });

  it("never stores more than MAX_EDGES_PER_WALLET edges", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    const deps = Array.from({ length: 12 }, (_, i) => ({ block: 100 + i * 50, from: BIG, value: 2n ** BigInt(i) * MON }));
    const { rpc } = archive(deps);
    await resolveFundingTree({ db, book, rpc }, W, 1000, 1);
    expect((await db.select().from(s.fundingEdges)).length).toBeLessThanOrEqual(MAX_EDGES_PER_WALLET);
    close();
  });
});
