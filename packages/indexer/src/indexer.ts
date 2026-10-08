import { eq, isNotNull, sql } from "drizzle-orm";
import {
  NADFUN_MAINNET,
  TOPICS,
  chunkRange,
  schema,
  toHex,
  type Db,
  type RpcClient,
  type RpcLog,
} from "@nuno/shared";
import { decodeCurveLog, decodeSwapLog, decodeTransferLog, logMeta } from "./decode.js";

export const INDEXER_CURSOR = "indexer";
const ADDRESS_BATCH = 50;

export interface IndexerCtx {
  db: Db;
  logsRpc: RpcClient;
  logsRange: number;
  log?: (msg: string) => void;
}

export interface RangeStats {
  creates: number;
  trades: number;
  graduations: number;
  transfers: number;
  swaps: number;
}

async function getLogs(rpc: RpcClient, filter: { address?: string | string[]; topics?: unknown[] }, from: number, to: number) {
  return rpc.call<RpcLog[]>("eth_getLogs", [{ ...filter, fromBlock: toHex(from), toBlock: toHex(to) }]);
}

/**
 * Index one block range (must fit the RPC's log-range limit). Idempotent: every insert is
 * keyed by (tx hash, log index) or token address, so re-running a range is safe.
 */
export async function indexRange(ctx: IndexerCtx, from: number, to: number): Promise<RangeStats> {
  const { db, logsRpc } = ctx;
  const stats: RangeStats = { creates: 0, trades: 0, graduations: 0, transfers: 0, swaps: 0 };

  const curveLogs = await getLogs(
    logsRpc,
    { address: NADFUN_MAINNET.CURVE, topics: [[TOPICS.CurveCreate, TOPICS.CurveBuy, TOPICS.CurveSell, TOPICS.CurveGraduate]] },
    from,
    to,
  );

  for (const l of curveLogs) {
    const m = logMeta(l);
    const r = decodeCurveLog(l);
    if (r.kind === "create") {
      await db
        .insert(schema.tokens)
        .values({
          address: r.token,
          creator: r.creator,
          curvePool: r.pool,
          name: r.name,
          symbol: r.symbol,
          tokenUri: r.tokenUri,
          createBlock: m.block,
          createTx: m.txHash,
        })
        .onConflictDoNothing();
      stats.creates++;
    } else if (r.kind === "trade") {
      await db
        .insert(schema.curveTrades)
        .values({
          ...m,
          token: r.token,
          trader: r.trader,
          side: r.side,
          amountIn: r.amountIn.toString(),
          amountOut: r.amountOut.toString(),
        })
        .onConflictDoNothing();
      stats.trades++;
    } else if (r.kind === "graduate") {
      await db
        .update(schema.tokens)
        .set({ graduatedPool: r.pool, graduatedBlock: m.block })
        .where(eq(schema.tokens.address, r.token));
      stats.graduations++;
    }
  }

  // Tracked tokens = every token whose CurveCreate we've indexed (created within the window).
  const tracked = await db
    .select({ address: schema.tokens.address, pool: schema.tokens.graduatedPool })
    .from(schema.tokens)
    .where(sql`${schema.tokens.createBlock} <= ${to}`);

  for (let i = 0; i < tracked.length; i += ADDRESS_BATCH) {
    const batch = tracked.slice(i, i + ADDRESS_BATCH).map((t) => t.address);
    const logs = await getLogs(logsRpc, { address: batch, topics: [TOPICS.Transfer] }, from, to);
    const rows = logs.flatMap((l) => {
      const t = decodeTransferLog(l);
      return t ? [{ ...logMeta(l), token: t.token, from: t.from, to: t.to, value: t.value.toString() }] : [];
    });
    if (rows.length) await db.insert(schema.transfers).values(rows).onConflictDoNothing();
    stats.transfers += rows.length;
  }

  const pools = tracked.filter((t): t is { address: string; pool: string } => t.pool !== null);
  const poolToToken = new Map(pools.map((p) => [p.pool, p.address]));
  for (let i = 0; i < pools.length; i += ADDRESS_BATCH) {
    const batch = pools.slice(i, i + ADDRESS_BATCH).map((p) => p.pool);
    const logs = await getLogs(logsRpc, { address: batch }, from, to);
    const rows = logs.flatMap((l) => {
      const s = decodeSwapLog(l);
      const token = s && poolToToken.get(s.pool);
      return s && token
        ? [{ ...logMeta(l), pool: s.pool, token, sender: s.sender, recipient: s.recipient, amount0: s.amount0.toString(), amount1: s.amount1.toString() }]
        : [];
    });
    if (rows.length) await db.insert(schema.dexSwaps).values(rows).onConflictDoNothing();
    stats.swaps += rows.length;
  }

  return stats;
}

export async function getCursor(db: Db, name: string): Promise<number | null> {
  const rows = await db.select().from(schema.cursors).where(eq(schema.cursors.name, name));
  return rows[0]?.block ?? null;
}

export async function setCursor(db: Db, name: string, block: number): Promise<void> {
  await db
    .insert(schema.cursors)
    .values({ name, block })
    .onConflictDoUpdate({ target: schema.cursors.name, set: { block, updatedAt: new Date() } });
}

/** Index [from, to] sequentially, advancing the cursor after each chunk so the job resumes cleanly. */
export async function indexBlocks(ctx: IndexerCtx, from: number, to: number): Promise<RangeStats> {
  const total: RangeStats = { creates: 0, trades: 0, graduations: 0, transfers: 0, swaps: 0 };
  const chunks = chunkRange(from, to, ctx.logsRange);
  let n = 0;
  for (const [a, b] of chunks) {
    const s = await indexRange(ctx, a, b);
    for (const k of Object.keys(total) as Array<keyof RangeStats>) total[k] += s[k];
    await setCursor(ctx.db, INDEXER_CURSOR, b);
    if (++n % 50 === 0 || n === chunks.length) {
      ctx.log?.(`[indexer] ${n}/${chunks.length} chunks, block ${b}, totals ${JSON.stringify(total)}`);
    }
  }
  return total;
}

export async function countRows(db: Db) {
  const [tokens] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.tokens);
  const [graduated] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tokens)
    .where(isNotNull(schema.tokens.graduatedPool));
  const [trades] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.curveTrades);
  const [transfers] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.transfers);
  const [swaps] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.dexSwaps);
  return { tokens: tokens?.n, graduated: graduated?.n, trades: trades?.n, transfers: transfers?.n, swaps: swaps?.n };
}
