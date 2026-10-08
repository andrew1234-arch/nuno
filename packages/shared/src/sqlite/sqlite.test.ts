import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AddressBook, txBytes, txHex } from "./addresses.js";
import { insertIgnore } from "./client.js";
import { openLocal } from "./local.js";
import { curveTrades, cursors, tokenMetrics } from "./schema.js";

// Hand-built test fixtures (not real chain data).
const A = "0x" + "aa".repeat(20);
const B = "0x" + "bb".repeat(20);
const TX = "0x" + "11".repeat(32);

describe("local SQLite (node:sqlite + drizzle proxy)", () => {
  it("applies migrations and round-trips rows", async () => {
    const { db, close } = openLocal(":memory:");
    await db.insert(cursors).values({ name: "x", block: 5, updatedAt: 1 });
    const [c] = await db.select().from(cursors).where(eq(cursors.name, "x"));
    expect(c).toEqual({ name: "x", block: 5, updatedAt: 1 });
    close();
  });

  it("stores hashes as 32-byte blobs and big amounts as text", async () => {
    const { db, close } = openLocal(":memory:");
    const big = (2n ** 200n).toString();
    await db.insert(curveTrades).values({ tx: txBytes(TX), logIndex: 0, block: 1, token: 1, trader: 2, side: 0, amountIn: big, amountOut: "1" });
    const [r] = await db.select().from(curveTrades);
    expect(r!.tx).toBeInstanceOf(Uint8Array);
    expect(r!.tx.length).toBe(32);
    expect(txHex(r!.tx)).toBe(TX);
    expect(BigInt(r!.amountIn)).toBe(2n ** 200n);
    close();
  });

  it("insertIgnore chunks under the 100-parameter limit and is idempotent", async () => {
    const { db, raw, close } = openLocal(":memory:");
    const rows = Array.from({ length: 250 }, (_, i) => ({
      token: i + 1,
      sourceBlock: 1,
      totalSupply: "1",
      rawHolders: 1,
      realHolders: 1,
      effectiveTop10Bps: 0,
      clusterSupplyBps: 0,
      creatorLinkedSupplyBps: 0,
      rawVolume: "0",
      organicVolume: "0",
      organicVolumeBps: 0,
      evidenceRoot: txBytes(TX),
      computedAt: 0,
    }));
    await insertIgnore(db, tokenMetrics, rows); // 13 columns -> 7 rows per statement
    await insertIgnore(db, tokenMetrics, rows);
    expect((raw.prepare("select count(*) n from token_metrics").get() as { n: number }).n).toBe(250);
    close();
  });
});

describe("AddressBook", () => {
  it("assigns stable ids, is case-insensitive, and resolves back", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    const ids = await book.ids([A, B, A.toUpperCase().replace("0X", "0x")]);
    expect(ids.size).toBe(2);
    const fresh = new AddressBook(db); // new cache, same DB
    expect(await fresh.id(B)).toBe(ids.get(B));
    expect(await fresh.hex(ids.get(A)!)).toBe(A);
    expect(await fresh.find("0x" + "cc".repeat(20))).toBeUndefined();
    close();
  });

  it("handles more addresses than fit in one statement", async () => {
    const { db, close } = openLocal(":memory:");
    const many = Array.from({ length: 450 }, (_, i) => "0x" + i.toString(16).padStart(40, "0"));
    const ids = await new AddressBook(db).ids(many);
    expect(new Set(ids.values()).size).toBe(450);
    close();
  });
});
