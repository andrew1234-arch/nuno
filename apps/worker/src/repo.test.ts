import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import { fullRun } from "@nuno/metrics/store";
import { AddressBook, sqliteSchema as s, txBytes, type RpcClient } from "@nuno/shared";
import { openLocal } from "@nuno/shared/node";
import { createApp } from "./app.js";
import type { EntityDto, TokenDto, WalletDto } from "./repo.js";
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
  return { app: createApp(new SqlRepo(db), { cacheTtlMs: 0 }), close };
}

describe("Worker API over SQLite (SqlRepo)", () => {
  it("serves tokens with metrics and the operator entity with evidence", async () => {
    const { app, close } = await setup();
    const list = (await (await app.request("/tokens?sort=newest")).json()) as { tokens: TokenDto[] };
    expect(list.tokens.map((t) => t.address)).toEqual([T2, T1]);
    expect(list.tokens[1]!.creator).toBe(C1);
    expect(list.tokens[1]!.metrics!.rawHolders).toBe(1);

    const cl = (await (await app.request(`/tokens/${T1}/clusters`)).json()) as { clusters: EntityDto[] };
    expect(cl.clusters).toHaveLength(1);
    expect(cl.clusters[0]!.members).toEqual([C1, C2]);
    expect(cl.clusters[0]!.createdTokens).toEqual([T1, T2]);
    expect(cl.clusters[0]!.links[0]!.evidence.map((e) => e.txHash).sort()).toEqual([tx(10), tx(12)]);

    const ent = (await (await app.request(`/clusters/${C1}`)).json()) as EntityDto;
    expect(ent.size).toBe(2);
    expect((await app.request(`/clusters/${C2}`)).status).toBe(404); // ids are the smallest member
    close();
  });

  it("serves evidence whose keccak256 equals the stored evidenceRoot", async () => {
    const { app, close } = await setup();
    const tok = (await (await app.request(`/tokens/${T1}`)).json()) as TokenDto;
    const ev = (await (await app.request(`/tokens/${T1}/evidence`)).json()) as { canonical: string };
    expect(keccak256(stringToHex(ev.canonical))).toBe(tok.metrics!.evidenceRoot);
    close();
  });

  it("attributes bot-routed trades to the signing wallet", async () => {
    const { app, close } = await setup();
    const w = (await (await app.request(`/wallets/${W}`)).json()) as WalletDto;
    expect(w.trades).toEqual([{ token: T1, buys: 1, sells: 0 }]);
    const bot = (await (await app.request(`/wallets/${BOT}`)).json()) as WalletDto;
    expect(bot.isContract).toBe(true);
    const f = (await (await app.request(`/wallets/${F}`)).json()) as WalletDto;
    expect(f.funded.map((e) => e.wallet).sort()).toEqual([C1, C2]);
    close();
  });
});
