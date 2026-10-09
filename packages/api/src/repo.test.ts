import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { fullRun } from "@nuno/metrics/store";
import { AddressBook, sqliteSchema as s, txBytes, type RpcClient } from "@nuno/shared";
import { openLocal } from "@nuno/shared/node";
import { SqlRepo } from "./repo.js";

// Hand-built test fixtures (not real chain data): two launches by one operator, one bot-routed trade.
const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const [F, C1, C2, W, BOT, T1, T2, P1, P2, ZERO] = [0xf0, 0xc1, 0xc2, 0xe1, 0xb0, 0x71, 0x72, 0x81, 0x82, 0].map(a) as [
  string, string, string, string, string, string, string, string, string, string,
];
const rpc = { call: async (_m: string, p: unknown[]) => ((p[0] as string)?.toLowerCase() === BOT ? "0x6080" : "0x") } as unknown as RpcClient;

async function setup() {
  const { db, close } = openLocal(":memory:");
  const book = new AddressBook(db);
  const id = (x: string) => book.id(x);
  for (const [t, c, p, b] of [[T1, C1, P1, 100], [T2, C2, P2, 300]] as const) {
    await db.insert(s.tokens).values({ id: await id(t), creator: await id(c), curvePool: await id(p), name: t, symbol: `S${b}`, createBlock: b, createTx: txBytes(tx(b)) });
    await db.insert(s.transfers).values([
      { tx: txBytes(tx(b)), logIndex: 1, block: b, token: await id(t), from: await id(ZERO), to: await id(p), value: "10000" },
      { tx: txBytes(tx(b + 1)), logIndex: 1, block: b + 1, token: await id(t), from: await id(p), to: await id(c), value: "1000" },
    ]);
    await db.insert(s.curveTrades).values({ tx: txBytes(tx(b + 1)), logIndex: 0, block: b + 1, token: await id(t), trader: await id(c), txFrom: await id(c), side: 0, amountIn: "100", amountOut: "1000" });
  }
  // W buys T1 through a bot contract (curve sender = BOT, signer = W).
  await db.insert(s.curveTrades).values({ tx: txBytes(tx(150)), logIndex: 0, block: 150, token: await id(T1), trader: await id(BOT), txFrom: await id(W), side: 0, amountIn: "5", amountOut: "50" });
  await db.insert(s.fundingEdges).values([
    { wallet: await id(C1), funder: await id(F), origin: await id(F), kind: 0, value: "15", block: 10, blockTime: 1_000, tx: txBytes(tx(10)), source: 0 },
    { wallet: await id(C2), funder: await id(F), origin: await id(F), kind: 0, value: "15", block: 12, blockTime: 1_060, tx: txBytes(tx(12)), source: 0 },
  ]);
  await db.insert(s.cursors).values({ name: "indexer", block: 1000, updatedAt: 0 });
  await fullRun({ db, book, rpc, infrastructure: new Set() }, 1000);
  return { repo: new SqlRepo(db), close };
}

describe("API read model over SQLite (SqlRepo)", () => {
  it("serves tokens with metrics and the operator entity with evidence", async () => {
    const { repo, close } = await setup();
    const tokens = (await repo.listTokens()).sort((x, y) => y.createBlock - x.createBlock);
    expect(tokens.map((t) => t.address)).toEqual([T2, T1]);
    expect(tokens[1]!.creator).toBe(C1);
    expect(tokens[1]!.metrics!.rawHolders).toBe(1);

    const clusters = await repo.entitiesForToken(T1);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.members).toEqual([C1, C2]);
    expect(clusters[0]!.createdTokens).toEqual([T1, T2]);
    expect(clusters[0]!.links[0]!.evidence.map((e) => e.txHash).sort()).toEqual([tx(10), tx(12)]);

    const ent = await repo.getEntity(C1);
    expect(ent!.size).toBe(2);
    expect(await repo.getEntity(C2)).toBeNull(); // ids are the smallest member
    close();
  });

  it("serves evidence whose keccak256 equals the stored evidenceRoot", async () => {
    const { repo, close } = await setup();
    const tok = await repo.getToken(T1);
    const canonical = await repo.evidenceJson(T1);
    expect(keccak256(stringToHex(canonical!))).toBe(tok!.metrics!.evidenceRoot);
    expect(await repo.evidenceJson(C1)).toBeNull(); // not a token
    close();
  });

  it("attributes bot-routed trades to the signing wallet", async () => {
    const { repo, close } = await setup();
    const w = await repo.getWallet(W);
    expect(w!.trades).toEqual([{ token: T1, buys: 1, sells: 0 }]);
    const bot = await repo.getWallet(BOT);
    expect(bot!.isContract).toBe(true);
    const f = await repo.getWallet(F);
    expect(f!.funded.map((e) => e.wallet).sort()).toEqual([C1, C2]);
    close();
  });
});
