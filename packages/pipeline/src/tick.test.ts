import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { getCursor } from "@nuno/indexer";
import { fullRun } from "@nuno/metrics/store";
import { AddressBook, NADFUN_MAINNET, curveEventsAbi, erc20TransferAbi, sqliteSchema as s, txBytes, type RpcClient, type RpcLog } from "@nuno/shared";
import { openLocal } from "@nuno/shared/node";
import { DEFAULT_BUDGET } from "@nuno/metrics";
import { METRICS_CURSOR, tick, type TickSettings } from "./tick.js";

// Hand-built test fixtures (not real chain data): an operator (funder F, creators C1/C2) and a
// new wallet N, funded by F, that buys the operator's token T2 during the tick.
const a = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Hex;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const [F, C1, C2, N, T1, T2, P1, P2, ZERO] = [0xf0, 0xc1, 0xc2, 0xe5, 0x71, 0x72, 0x81, 0x82, 0].map(a) as [Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex, Hex];
const CURVE = NADFUN_MAINNET.CURVE.toLowerCase() as Hex;
const START = 1_000; // indexer cursor after the "backfill"
const HEAD = 1_150; // chain head during the tick (SAFE_LAG 10 -> indexes to 1,140)
const BUY_BLOCK = 1_050;
const N_FUNDED = 900;

const cfg: TickSettings = {
  logsRange: 100,
  backfillDays: 7,
  minBuyers: 20,
  budget: DEFAULT_BUDGET,
  maxBlocksPerRun: 2_000,
  maxFundingPerRun: 5,
  maxPublishPerRun: 10,
  publisher: null,
  nansen: {}, // no key: the pipeline must still run
};

const hex = (n: number | bigint) => `0x${n.toString(16)}` as Hex;
const LOGS: RpcLog[] = [
  {
    address: CURVE,
    topics: encodeEventTopics({ abi: curveEventsAbi, eventName: "CurveBuy", args: { sender: N, token: T2 } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [100n, 500n]),
    blockNumber: hex(BUY_BLOCK),
    transactionHash: tx(BUY_BLOCK),
    logIndex: "0x0",
  },
  {
    address: T2,
    topics: encodeEventTopics({ abi: erc20TransferAbi, eventName: "Transfer", args: { from: P2, to: N } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [500n]),
    blockNumber: hex(BUY_BLOCK),
    transactionHash: tx(BUY_BLOCK),
    logIndex: "0x1",
  },
];

const fake = {
  async call(method: string, params: unknown[]) {
    const p0 = params[0] as string;
    switch (method) {
      case "eth_blockNumber":
        return hex(HEAD);
      case "eth_getLogs": {
        const f = params[0] as { address: string | string[]; fromBlock: Hex; toBlock: Hex };
        const addrs = (Array.isArray(f.address) ? f.address : [f.address]).map((x) => x.toLowerCase());
        return LOGS.filter((l) => addrs.includes(l.address.toLowerCase()) && Number(l.blockNumber) >= Number(f.fromBlock) && Number(l.blockNumber) <= Number(f.toBlock));
      }
      case "eth_getTransactionByHash":
        return { from: N };
      case "eth_getCode":
        return "0x";
      case "eth_getBalance":
      case "eth_getTransactionCount":
        // Only N is resolved in this test: funded at N_FUNDED.
        return hex(p0.toLowerCase() === N && Number(params[1]) >= N_FUNDED ? 1 : 0);
      case "eth_getBlockByNumber":
        return { number: params[0], timestamp: hex(2_000), transactions: Number(params[0]) === N_FUNDED ? [{ hash: tx(N_FUNDED), from: F, to: N, value: "0x5" }] : [] };
      case "debug_traceBlockByNumber":
        return [];
      default:
        throw new Error(`unexpected ${method}`);
    }
  },
} as unknown as RpcClient;

async function seeded() {
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
  // Operator wallets already resolved (first funded by F, 60 s apart). N is new.
  for (const [w, t] of [[C1, 1_000], [C2, 1_060]] as const) {
    await db.insert(s.fundingEdges).values({ wallet: await id(w), funder: await id(F), origin: await id(F), kind: 0, value: "15", block: 10, blockTime: t, tx: txBytes(tx(t)), source: 0 });
    await db.insert(s.wallets).values({ id: await id(w), isContract: 0, fundingStatus: s.FUNDING_STATUS.resolved, firstFundedBlock: 10, resolvedAt: 1 });
  }
  await db.insert(s.cursors).values({ name: "indexer", block: START, updatedAt: 0 });
  await fullRun({ db, book, rpc: fake, infrastructure: new Set() }, START);
  await db.insert(s.cursors).values({ name: METRICS_CURSOR, block: START, updatedAt: Date.now() }).onConflictDoNothing();
  return { db, book, close };
}

describe("pipeline tick (tick.yml / pnpm tick) on SQLite", () => {
  it("indexes new blocks, resolves the new buyer, merges it into the operator entity and updates metrics", async () => {
    const { db, book, close } = await seeded();
    const out = await tick(db, cfg, { logsRpc: fake, archiveRpc: fake });
    expect(out.indexed).toMatchObject({ trades: 1, transfers: 1 });
    expect(out.funded).toBe(1);
    expect(await getCursor(db, "indexer")).toBe(HEAD - 10);
    expect(await getCursor(db, METRICS_CURSOR)).toBe(HEAD - 10);

    // N was first-funded by F within 24 h of C1/C2 -> same entity (id = smallest address = C1).
    const members = await db.select().from(s.entityMembers);
    const entityOf = new Map(members.map((m) => [m.wallet, m.entity]));
    expect(entityOf.get(await book.id(N))).toBe(await book.id(C1));
    expect(entityOf.get(await book.id(C2))).toBe(await book.id(C1));

    // T2's metrics now count N as a holder of the operator entity.
    const [m] = await db.select().from(s.tokenMetrics).where(eq(s.tokenMetrics.token, await book.id(T2)));
    expect(m!.rawHolders).toBe(2); // C2 and N
    expect(m!.realHolders).toBe(1); // one entity
    expect(m!.clusterSupplyBps).toBe(1500); // (1000 + 500) / 10000
    close();
  });

  it("is a no-op when there is nothing new", async () => {
    const { db, close } = await seeded();
    await tick(db, cfg, { logsRpc: fake, archiveRpc: fake });
    const before = await db.select().from(s.tokenMetrics);
    const out = await tick(db, cfg, { logsRpc: fake, archiveRpc: fake });
    expect(out.funded).toBe(0);
    expect(out.metrics).toBeUndefined();
    expect(await db.select().from(s.tokenMetrics)).toEqual(before);
    close();
  });
});

describe("tick regressions from code review", () => {
  it("a missing metrics cursor does not turn every resolved wallet into 'newly funded'", async () => {
    const { db, close } = await seeded();
    await db.delete(s.cursors).where(eq(s.cursors.name, METRICS_CURSOR));
    const out = await tick(db, cfg, { logsRpc: fake, archiveRpc: fake });
    // Only wallets resolved during this run count as new: N and its funder F (looked up as hop 2).
    // C1/C2, resolved by the backfill, do not (they would make this 4).
    expect(out.metrics).toMatchObject({ newlyFunded: 2 });
    close();
  });

  it("funding ancestors resolved as hops never become entity members", async () => {
    const { db, book, close } = await seeded();
    // F (operator funder) and an unrelated H were both first-funded by G within 24 h, and were
    // resolved as hop-2 ancestors. They never traded or held a token.
    const G = a(0x60);
    const H = a(0x61);
    for (const [w, t] of [[F, 500], [H, 510]] as const) {
      await db.insert(s.fundingEdges).values({ wallet: await book.id(w), funder: await book.id(G), origin: await book.id(G), kind: 0, value: "9", block: 5, blockTime: t, tx: txBytes(tx(t)), source: 0 });
      await db.insert(s.wallets).values({ id: await book.id(w), isContract: 0, fundingStatus: s.FUNDING_STATUS.resolved, firstFundedBlock: 5, resolvedAt: Date.now() + 1 });
    }
    await tick(db, cfg, { logsRpc: fake, archiveRpc: fake });
    const members = new Set((await db.select().from(s.entityMembers)).map((m) => m.wallet));
    expect(members.has(await book.id(F))).toBe(false);
    expect(members.has(await book.id(H))).toBe(false);
    close();
  });
});
