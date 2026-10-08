import { and, eq, inArray, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import {
  schema,
  toHex,
  type BlockTraceEntry,
  type Db,
  type RpcBlock,
  type RpcClient,
} from "@nuno/shared";
import { firstTrueBlock } from "./search.js";
import { directTransfersFromBlock, extractInboundTransfers, type InboundTransfer } from "./trace.js";

export interface FundingCtx {
  db: Db;
  /** Must serve archive state and debug_traceBlockByNumber (e.g. rpc1.monad.xyz). */
  rpc: RpcClient;
  log?: (msg: string) => void;
}

export type WalletFunding =
  | { status: "resolved"; block: number; blockTime: number; transfers: InboundTransfer[]; isContract: boolean }
  | { status: "unfunded"; isContract: boolean }
  | { status: "contract"; isContract: true };

async function isContract(rpc: RpcClient, addr: Address, block: number): Promise<boolean> {
  const code = await rpc.call<Hex>("eth_getCode", [addr, toHex(block)], { cache: true });
  return code !== "0x" && code.length > 2;
}

async function touched(rpc: RpcClient, addr: Address, block: number): Promise<boolean> {
  const [bal, nonce] = await Promise.all([
    rpc.call<Hex>("eth_getBalance", [addr, toHex(block)], { cache: true }),
    rpc.call<Hex>("eth_getTransactionCount", [addr, toHex(block)], { cache: true }),
  ]);
  return BigInt(bal) > 0n || BigInt(nonce) > 0n;
}

/**
 * Find the first native-MON funding of `wallet` at or before `beforeBlock`, with evidence.
 * Source: archive state (binary search) + callTracer on the funding block.
 */
export async function resolveFirstFunding(rpc: RpcClient, wallet: Address, beforeBlock: number): Promise<WalletFunding> {
  if (await isContract(rpc, wallet, beforeBlock)) return { status: "contract", isContract: true };

  const block = await firstTrueBlock(0, beforeBlock, (b) => touched(rpc, wallet, b));
  if (block === null) return { status: "unfunded", isContract: false };

  const body = await rpc.call<RpcBlock>("eth_getBlockByNumber", [toHex(block), true], { cache: true });
  let transfers = directTransfersFromBlock(body, wallet);
  if (transfers.length === 0) {
    const traces = await rpc.call<BlockTraceEntry[]>(
      "debug_traceBlockByNumber",
      [toHex(block), { tracer: "callTracer" }],
      { cache: true },
    );
    transfers = extractInboundTransfers(traces, wallet);
  }
  return { status: "resolved", block, blockTime: Number(body.timestamp), transfers, isContract: false };
}

/** Persist one wallet's funding result; returns the origin EOAs to resolve at the next hop. */
async function store(db: Db, wallet: Address, f: WalletFunding): Promise<Address[]> {
  if (f.status !== "resolved") {
    await db
      .insert(schema.wallets)
      .values({ address: wallet, isContract: f.isContract, fundingStatus: "unfunded", resolvedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.wallets.address,
        set: { isContract: f.isContract, fundingStatus: "unfunded", resolvedAt: new Date() },
      });
    return [];
  }
  if (f.transfers.length) {
    await db
      .insert(schema.fundingEdges)
      .values(
        f.transfers.map((t) => ({
          wallet,
          funder: t.funder,
          origin: t.origin,
          kind: t.kind,
          value: t.value.toString(),
          block: f.block,
          blockTime: f.blockTime,
          txHash: t.txHash,
          source: "rpc_archive_trace" as const,
        })),
      )
      .onConflictDoNothing();
  }
  // A touched block with no value frame to the wallet (e.g. gas-sponsored/7702 first tx) is
  // recorded as resolved with no edges, and the reason kept for the methodology's limitations.
  const note = f.transfers.length ? null : "first-touch block has no inbound value frame";
  await db
    .insert(schema.wallets)
    .values({ address: wallet, isContract: false, fundingStatus: "resolved", firstFundedBlock: f.block, fundingError: note, resolvedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.wallets.address,
      set: { isContract: false, fundingStatus: "resolved", firstFundedBlock: f.block, fundingError: note, resolvedAt: new Date() },
    });
  return [...new Set(f.transfers.map((t) => t.origin))].filter((o) => o !== wallet);
}

type Hop = { addr: Address; before: number };

// Concurrent workers often reach the same funder; share one lookup per address.
const inflight = new Map<Address, Promise<Hop[]>>();

/** Resolve one address (DB cache first) and return its funders as the next hop. */
function resolveOne(ctx: FundingCtx, addr: Address, before: number, hop: number): Promise<Hop[]> {
  const existing = inflight.get(addr);
  if (existing) return existing;
  const p = (async (): Promise<Hop[]> => {
    const [c] = await ctx.db.select().from(schema.wallets).where(eq(schema.wallets.address, addr));
    if (c && c.fundingStatus !== "pending" && c.fundingStatus !== "error") {
      if (c.fundingStatus !== "resolved" || c.firstFundedBlock === null) return [];
      const edges = await ctx.db
        .select({ origin: schema.fundingEdges.origin })
        .from(schema.fundingEdges)
        .where(eq(schema.fundingEdges.wallet, addr));
      const block = c.firstFundedBlock;
      return edges.filter((e) => e.origin !== addr).map((e) => ({ addr: e.origin as Address, before: block }));
    }
    try {
      const f = await resolveFirstFunding(ctx.rpc, addr, before);
      const origins = await store(ctx.db, addr, f);
      ctx.log?.(`[funding] hop ${hop} ${addr}: ${f.status}${f.status === "resolved" ? ` @${f.block} <- ${origins.join(",") || "(none)"}` : ""}`);
      return f.status === "resolved" ? origins.map((o) => ({ addr: o, before: f.block })) : [];
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await ctx.db
        .insert(schema.wallets)
        .values({ address: addr, fundingStatus: "error", fundingError: msg })
        .onConflictDoUpdate({ target: schema.wallets.address, set: { fundingStatus: "error", fundingError: msg } });
      ctx.log?.(`[funding] hop ${hop} ${addr}: ERROR ${msg}`);
      return [];
    }
  })().finally(() => inflight.delete(addr));
  inflight.set(addr, p);
  return p;
}

/**
 * Resolve first funding for `wallet`, then its funders' first funding, up to `maxHops`.
 * Cached: wallets already resolved/unfunded in the DB are not re-queried.
 */
export async function resolveFundingTree(ctx: FundingCtx, wallet: Address, beforeBlock: number, maxHops = 3) {
  let frontier: Hop[] = [{ addr: wallet, before: beforeBlock }];
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: Hop[] = [];
    for (const { addr, before } of frontier) next.push(...(await resolveOne(ctx, addr, before, hop)));
    frontier = next;
  }
}

/** Buyers of tracked tokens with their first buy block, not yet resolved. */
export async function pendingBuyers(db: Db, limit: number): Promise<Array<{ trader: Address; firstBuy: number }>> {
  const rows = await db
    .select({ trader: schema.curveTrades.trader, firstBuy: sql<number>`min(${schema.curveTrades.block})::bigint` })
    .from(schema.curveTrades)
    .leftJoin(schema.wallets, eq(schema.wallets.address, schema.curveTrades.trader))
    .where(and(eq(schema.curveTrades.side, "buy"), sql`(${schema.wallets.fundingStatus} is null or ${schema.wallets.fundingStatus} in ('pending','error'))`))
    .groupBy(schema.curveTrades.trader)
    .limit(limit);
  return rows.map((r) => ({ trader: r.trader as Address, firstBuy: Number(r.firstBuy) }));
}

export async function fundingEdgesFor(db: Db, wallets: Address[]) {
  if (!wallets.length) return [];
  return db.select().from(schema.fundingEdges).where(inArray(schema.fundingEdges.wallet, wallets));
}
