import { describe, expect, it } from "vitest";
import { AddressBook, sqliteSchema as s, txBytes } from "@nuno/shared";
import { openLocal } from "@nuno/shared/node";
import { prune } from "./prune.js";

// Hand-built test fixtures (not real chain data).
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const DAY = 286_093; // blocks per day at 0.302 s
const HEAD = 10 * DAY;

describe("prune (SPEC §7.11 rules 5, 6, 9)", () => {
  it("prunes out-of-window and low-buyer tokens to a summary, keeps the rest", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    const id = (n: number) => book.id(`0x${n.toString(16).padStart(40, "0")}`);
    const mk = async (tok: number, createBlock: number, buyers: number) => {
      await db.insert(s.tokens).values({ id: await id(tok), creator: await id(1), curvePool: await id(2), name: "t", symbol: "T", createBlock, createTx: txBytes(tx(tok)) });
      for (let i = 0; i < buyers; i++) {
        await db.insert(s.curveTrades).values({ tx: txBytes(tx(tok * 1000 + i)), logIndex: 0, block: createBlock + 1, token: await id(tok), trader: await id(500 + i), side: 0, amountIn: "1", amountOut: "1" });
      }
      await db.insert(s.tokenMetrics).values({
        token: await id(tok), sourceBlock: HEAD, totalSupply: "1", rawHolders: 1, realHolders: 1, effectiveTop10Bps: 0, clusterSupplyBps: 0,
        creatorLinkedSupplyBps: 0, rawVolume: "0", organicVolume: "0", organicVolumeBps: 0, evidenceRoot: txBytes(tx(1)), computedAt: 0,
      });
    };
    await mk(0x71, 1 * DAY, 30); // outside window (window starts at day 3) -> pruned
    await mk(0x72, 5 * DAY, 3); // older than 24h, 3 buyers < 20 -> pruned
    await mk(0x73, 5 * DAY, 25); // older than 24h, enough buyers -> kept
    await mk(0x74, HEAD - 100, 1); // younger than 24h -> kept regardless
    const r = await prune(db, { head: HEAD, windowStartBlock: 3 * DAY, minBuyers: 20, nowMs: 0 });
    expect(r.prunedTokens).toBe(2);
    expect(r.deletedTrades).toBe(33);
    const pruned = (await db.select().from(s.tokens)).filter((t) => t.pruned === 1).map((t) => t.id);
    expect(pruned.sort()).toEqual([await id(0x71), await id(0x72)].sort());
    // Summaries survive.
    expect((await db.select().from(s.tokenMetrics)).length).toBe(4);
    expect((await db.select().from(s.curveTrades)).length).toBe(26);
    close();
  });

  it("keeps the latest snapshot per token plus one per day", async () => {
    const { db, close } = openLocal(":memory:");
    const t = 7;
    const day = (d: number, h: number) => Date.UTC(2026, 9, d, h);
    const snaps = [
      { n: 1, at: day(6, 1), block: 1 },
      { n: 2, at: day(6, 9), block: 2 }, // last of Oct 6 -> kept
      { n: 3, at: day(7, 3), block: 3 },
      { n: 4, at: day(7, 8), block: 4 }, // last of Oct 7 and latest overall -> kept
    ];
    for (const sn of snaps) {
      await db.insert(s.snapshots).values({ tx: txBytes(tx(sn.n)), chainId: 10143, token: t, sourceBlock: sn.block, publishBlock: sn.block, evidenceRoot: txBytes(tx(0)), gasUsed: 1, effectiveGasPrice: "1", publishedAt: sn.at });
    }
    const r = await prune(db, { head: 0, windowStartBlock: 0, minBuyers: 0, nowMs: day(8, 0) });
    expect(r.deletedSnapshots).toBe(2);
    expect((await db.select().from(s.snapshots)).map((x) => x.publishBlock).sort()).toEqual([2, 4]);
    close();
  });
});
