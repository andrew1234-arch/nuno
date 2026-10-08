import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { AddressBook, NADFUN_MAINNET, curveEventsAbi, erc20TransferAbi, openLocal, sqliteSchema as s, txHex, type RpcClient, type RpcLog } from "@nuno/shared";
import { applyGraduations, countRows, indexCurveRange, indexTokenRange, trackedTokens } from "./indexer.js";

// Hand-built test fixtures (not real chain data): ABI-encoded logs served by a fake RPC.
const CURVE = NADFUN_MAINNET.CURVE.toLowerCase() as Hex;
const T = "0x00000000000000000000000000000000000000a1" as Hex; // token
const P = "0x00000000000000000000000000000000000000b1" as Hex; // curve pool
const G = "0x00000000000000000000000000000000000000c1" as Hex; // graduated pool
const C = "0x00000000000000000000000000000000000000c0" as Hex; // creator
const BOT = "0x00000000000000000000000000000000000000d0" as Hex; // bot contract (curve sender)
const W = "0x00000000000000000000000000000000000000e0" as Hex; // wallet signing through the bot
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

let li = 0;
function log(address: Hex, block: number, txh: Hex, topics: Hex[], data: Hex): RpcLog {
  return { address, topics, data, blockNumber: `0x${block.toString(16)}`, transactionHash: txh, logIndex: `0x${(li++).toString(16)}` };
}
const ev = (name: "CurveCreate" | "CurveBuy" | "CurveGraduate", args: Record<string, unknown>) =>
  encodeEventTopics({ abi: curveEventsAbi, eventName: name, args } as Parameters<typeof encodeEventTopics>[0]) as Hex[];

const LOGS: RpcLog[] = [
  // Graduation at block 50 is indexed in an EARLIER chunk than the create (out-of-order case).
  log(CURVE, 50, tx(1), ev("CurveGraduate", { token: T, pool: G }), "0x"),
  log(
    CURVE,
    120,
    tx(2),
    ev("CurveCreate", { creator: C, token: T, pool: P }),
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      ["Test", "TST", "ipfs://x", 1n, 2n, 3n],
    ),
  ),
  log(CURVE, 121, tx(3), ev("CurveBuy", { sender: BOT, token: T }), encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [10n ** 18n, 500n])),
  log(T, 120, tx(2), encodeEventTopics({ abi: erc20TransferAbi, eventName: "Transfer", args: { from: ZERO, to: P } }) as Hex[], encodeAbiParameters([{ type: "uint256" }], [1000n])),
  log(T, 121, tx(3), encodeEventTopics({ abi: erc20TransferAbi, eventName: "Transfer", args: { from: P, to: W } }) as Hex[], encodeAbiParameters([{ type: "uint256" }], [500n])),
];
const SIGNERS: Record<string, Hex> = { [tx(3)]: W };

const fakeRpc = {
  async call(method: string, params: unknown[]) {
    if (method === "eth_getLogs") {
      const f = params[0] as { address: string | string[]; topics?: unknown[]; fromBlock: Hex; toBlock: Hex };
      const addrs = (Array.isArray(f.address) ? f.address : [f.address]).map((a) => a.toLowerCase());
      return LOGS.filter((l) => {
        const b = Number(l.blockNumber);
        return addrs.includes(l.address.toLowerCase()) && b >= Number(f.fromBlock) && b <= Number(f.toBlock);
      });
    }
    if (method === "eth_getTransactionByHash") return { from: SIGNERS[params[0] as string] ?? C };
    throw new Error(`unexpected ${method}`);
  },
} as unknown as RpcClient;

describe("indexer on SQLite", () => {
  it("indexes creates, bot-routed trades with their signer, out-of-order graduations and transfers", async () => {
    const { db, close } = openLocal(":memory:");
    const book = new AddressBook(db);
    const ctx = { db, book, logsRpc: fakeRpc, logsRange: 100 };

    await indexCurveRange(ctx, 1, 100); // graduation first
    await indexCurveRange(ctx, 101, 200); // then the create + buy
    await applyGraduations(db);

    const [tok] = await db.select().from(s.tokens);
    expect(tok!.id).toBe(await book.find(T));
    expect(tok!.creator).toBe(await book.find(C));
    expect(tok!.graduatedPool).toBe(await book.find(G));
    expect(tok!.graduatedBlock).toBe(50);

    const [trade] = await db.select().from(s.curveTrades);
    expect(trade!.trader).toBe(await book.find(BOT));
    expect(trade!.txFrom).toBe(await book.find(W));
    expect(trade!.side).toBe(s.SIDE.buy);
    expect(txHex(trade!.tx)).toBe(tx(3));

    const tracked = await trackedTokens(ctx, 200);
    expect(tracked.map((t) => t.hex)).toEqual([T]);
    await indexTokenRange(ctx, 101, 200, tracked);
    await indexTokenRange(ctx, 101, 200, tracked); // idempotent
    const counts = await countRows(db);
    expect(counts.transfers).toBe(2);
    expect(counts.curve_trades).toBe(1);
    // Addresses stored once each: T, C, P, G, BOT, W, ZERO.
    expect(counts.addresses).toBe(7);
    close();
  });
});
