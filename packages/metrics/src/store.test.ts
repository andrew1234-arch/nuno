import { describe, expect, it } from "vitest";
import { bytesToHex } from "viem";
import { AddressBook, sqliteSchema as s, txBytes, type RpcClient, type SqlDb } from "@nuno/shared";
import { openLocal } from "@nuno/shared/node";
import { evidenceRoot } from "./metrics.js";
import { evidenceJsonFor, fullRun, incrementalRun } from "./store.js";

// Hand-built test fixtures (not real chain data): a miniature serial-launch operator.
const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const F = a(0xf0); // operator funding wallet
const C1 = a(0xc1);
const C2 = a(0xc2);
const X = a(0x99); // independent buyer, own funder
const FX = a(0xf9);
const T1 = a(0x71);
const T2 = a(0x72);
const P1 = a(0x81); // curve pools
const P2 = a(0x82);
const ZERO = a(0);

const eoaRpc = { call: async () => "0x" } as unknown as RpcClient;

async function seed(db: SqlDb, book: AddressBook, part: 1 | 2) {
  const id = async (x: string) => book.id(x);
  if (part === 1) {
    await db.insert(s.tokens).values({ id: await id(T1), creator: await id(C1), curvePool: await id(P1), name: "One", symbol: "ONE", createBlock: 100, createTx: txBytes(tx(1)) });
    await db.insert(s.fundingEdges).values([
      { wallet: await id(C1), funder: await id(F), origin: await id(F), kind: 0, value: "15", block: 10, blockTime: 1_000, tx: txBytes(tx(10)), source: 0 },
      { wallet: await id(X), funder: await id(FX), origin: await id(FX), kind: 0, value: "1", block: 11, blockTime: 1_000, tx: txBytes(tx(11)), source: 0 },
    ]);
    await db.insert(s.curveTrades).values([
      { tx: txBytes(tx(101)), logIndex: 0, block: 101, token: await id(T1), trader: await id(C1), txFrom: await id(C1), side: 0, amountIn: "100", amountOut: "1000" },
      { tx: txBytes(tx(102)), logIndex: 0, block: 102, token: await id(T1), trader: await id(X), txFrom: await id(X), side: 0, amountIn: "50", amountOut: "400" },
    ]);
    await db.insert(s.transfers).values([
      { tx: txBytes(tx(1)), logIndex: 1, block: 100, token: await id(T1), from: await id(ZERO), to: await id(P1), value: "10000" },
      { tx: txBytes(tx(101)), logIndex: 1, block: 101, token: await id(T1), from: await id(P1), to: await id(C1), value: "1000" },
      { tx: txBytes(tx(102)), logIndex: 1, block: 102, token: await id(T1), from: await id(P1), to: await id(X), value: "400" },
    ]);
  } else {
    // Later: second launch by C2, funded by the same operator 60 s after C1.
    await db.insert(s.tokens).values({ id: await id(T2), creator: await id(C2), curvePool: await id(P2), name: "Two", symbol: "TWO", createBlock: 300, createTx: txBytes(tx(2)) });
    await db.insert(s.fundingEdges).values({ wallet: await id(C2), funder: await id(F), origin: await id(F), kind: 0, value: "15", block: 12, blockTime: 1_060, tx: txBytes(tx(12)), source: 0 });
    await db.insert(s.curveTrades).values({ tx: txBytes(tx(301)), logIndex: 0, block: 301, token: await id(T2), trader: await id(C2), txFrom: await id(C2), side: 0, amountIn: "100", amountOut: "1000" });
    await db.insert(s.transfers).values([
      { tx: txBytes(tx(2)), logIndex: 1, block: 300, token: await id(T2), from: await id(ZERO), to: await id(P2), value: "10000" },
      { tx: txBytes(tx(301)), logIndex: 1, block: 301, token: await id(T2), from: await id(P2), to: await id(C2), value: "1000" },
    ]);
  }
}

async function snapshot(db: SqlDb, book: AddressBook) {
  const members = await db.select().from(s.entityMembers);
  const hex = await book.hexes(members.flatMap((m) => [m.wallet, m.entity]));
  const metrics = await db.select().from(s.tokenMetrics);
  const thex = await book.hexes(metrics.map((m) => m.token));
  return {
    members: members.map((m) => `${hex.get(m.wallet)}->${hex.get(m.entity)}`).sort(),
    metrics: metrics
      .map((m) => ({ token: thex.get(m.token), raw: m.rawHolders, real: m.realHolders, cluster: m.clusterSupplyBps, creator: m.creatorLinkedSupplyBps, root: bytesToHex(m.evidenceRoot) }))
      .sort((x, y) => x.token!.localeCompare(y.token!)),
  };
}

describe("store: full and incremental runs on SQLite", () => {
  it("full run finds the operator entity across tokens and stores metrics", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    await seed(db, book, 1);
    await seed(db, book, 2);
    const ctx = { db, book, rpc: eoaRpc, infrastructure: new Set<string>() };
    const r = await fullRun(ctx, 1000);
    expect(r.entities).toBe(1);
    const snap = await snapshot(db, book);
    expect(snap.members).toEqual([`${C1}->${C1}`, `${C2}->${C1}`]);
    const m1 = snap.metrics.find((m) => m.token === T1)!;
    expect(m1.raw).toBe(2); // C1 and X hold
    expect(m1.real).toBe(2);
    expect(m1.cluster).toBe(1000); // C1 holds 1000/10000 and is in a multi-wallet entity
    // The stored root matches the canonical JSON the API serves.
    expect(evidenceRoot(T1, []).root).not.toBe(m1.root);
    const json = await evidenceJsonFor(ctx, await book.id(T1));
    expect(JSON.parse(json).clusters[0].members).toEqual([C1, C2]);
    close();
  });

  it("incremental update converges to exactly the full-run result", async () => {
    // A: full run on everything at once.
    const A = openLocal(":memory:");
    const bookA = new AddressBook(A.db);
    await seed(A.db, bookA, 1);
    await seed(A.db, bookA, 2);
    await fullRun({ db: A.db, book: bookA, rpc: eoaRpc, infrastructure: new Set() }, 1000);

    // B: full run on part 1, then part 2 arrives and is applied incrementally.
    const B = openLocal(":memory:");
    const bookB = new AddressBook(B.db);
    await seed(B.db, bookB, 1);
    const ctxB = { db: B.db, book: bookB, rpc: eoaRpc, infrastructure: new Set<string>() };
    await fullRun(ctxB, 200);
    expect((await snapshot(B.db, bookB)).members).toEqual([]); // C1 alone so far
    await seed(B.db, bookB, 2);
    await incrementalRun(ctxB, 200, 1000, [await bookB.id(C2)]);

    const sa = await snapshot(A.db, bookA);
    const sb = await snapshot(B.db, bookB);
    expect(sa.members).toEqual([`${C1}->${C1}`, `${C2}->${C1}`]); // guard against vacuous equality
    expect(sb.members).toEqual(sa.members);
    // T1 was untouched by new trades but its creator's entity grew: it must be recomputed too.
    expect(sb.metrics).toEqual(sa.metrics);
    A.close();
    B.close();
  });

  it("is idempotent: re-running incremental changes nothing", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    await seed(db, book, 1);
    await seed(db, book, 2);
    const ctx = { db, book, rpc: eoaRpc, infrastructure: new Set<string>() };
    await fullRun(ctx, 1000);
    const before = await snapshot(db, book);
    expect(before.members.length).toBe(2);
    await incrementalRun(ctx, 0, 1000, [await book.id(C2)]);
    expect(await snapshot(db, book)).toEqual(before);
    close();
  });
});
