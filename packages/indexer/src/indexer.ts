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

/** Curve events (creates, trades, graduations) for one log-range-sized chunk. Idempotent. */
export async function indexCurveRange(ctx: IndexerCtx, from: number, to: number): Promise<RangeStats> {
  const { db, logsRpc } = ctx;
  const stats = emptyStats();
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
  return stats;
}

export interface TrackedToken {
  address: string;
  pool: string | null;
}

export async function trackedTokens(db: Db, upToBlock: number): Promise<TrackedToken[]> {
  // Tracked tokens = every token whose CurveCreate we've indexed (created within the window).
  return db
    .select({ address: schema.tokens.address, pool: schema.tokens.graduatedPool })
    .from(schema.tokens)
    .where(sql`${schema.tokens.createBlock} <= ${upToBlock}`);
}

/** ERC-20 Transfers of tracked tokens and Swaps on their graduated pools for one chunk. Idempotent. */
export async function indexTokenRange(ctx: IndexerCtx, from: number, to: number, tracked: TrackedToken[]): Promise<RangeStats> {
  const { db, logsRpc } = ctx;
  const stats = emptyStats();

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

/** Both passes for one chunk, in order (used by the live tail). */
export async function indexRange(ctx: IndexerCtx, from: number, to: number): Promise<RangeStats> {
  const a = await indexCurveRange(ctx, from, to);
  const b = await indexTokenRange(ctx, from, to, await trackedTokens(ctx.db, to));
  return addStats(a, b);
}

const emptyStats = (): RangeStats => ({ creates: 0, trades: 0, graduations: 0, transfers: 0, swaps: 0 });

function addStats(a: RangeStats, b: RangeStats): RangeStats {
  const out = emptyStats();
  for (const k of Object.keys(out) as Array<keyof RangeStats>) out[k] = a[k] + b[k];
  return out;
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

/**
 * Run `fn` over chunks with bounded concurrency. Calls `onDone(block)` with the highest block
 * such that every chunk up to it has completed, so a cursor saved there is always safe to resume from.
 */
export async function runChunks(
  chunks: Array<[number, number]>,
  concurrency: number,
  fn: (from: number, to: number) => Promise<void>,
  onDone: (watermark: number, completed: number) => Promise<void>,
): Promise<void> {
  const done = new Array<boolean>(chunks.length).fill(false);
  let next = 0;
  let low = 0; // first chunk index not yet known complete
  let completed = 0;
  let flushing = Promise.resolve();
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      const [a, b] = chunks[i]!;
      await fn(a, b);
      done[i] = true;
      completed++;
      if (i === low) {
        while (low < chunks.length && done[low]) low++;
        const mark = chunks[low - 1]![1];
        const c = completed;
        flushing = flushing.then(() => onDone(mark, c));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
  await flushing;
}

export const CURVE_CURSOR = "indexer:curve";
export const TOKEN_CURSOR = "indexer:tokens";
/** First block of the backfill window currently covered. */
export const WINDOW_CURSOR = "indexer:window_start";

/**
 * Backfill [from, to] in two resumable, parallel passes:
 *  1. curve events (defines the tracked token set),
 *  2. transfers + swaps for every token tracked by the end of pass 1.
 * Afterwards the shared INDEXER_CURSOR is set to `to` for the live tail.
 */
export async function backfill(ctx: IndexerCtx, from: number, to: number, concurrency = 8): Promise<void> {
  const log = ctx.log ?? (() => {});
  const curveFrom = Math.max(from, ((await getCursor(ctx.db, CURVE_CURSOR)) ?? from - 1) + 1);
  const curveChunks = chunkRange(curveFrom, to, ctx.logsRange);
  let logged1 = 0;
  log(`[indexer] pass 1 curve: ${curveChunks.length} chunks from ${curveFrom}`);
  await runChunks(
    curveChunks,
    concurrency,
    async (a, b) => void (await indexCurveRange(ctx, a, b)),
    async (mark, n) => {
      await setCursor(ctx.db, CURVE_CURSOR, mark);
      if (n - logged1 >= 100 || n === curveChunks.length) {
        logged1 = n;
        log(`[indexer] pass 1: ${n}/${curveChunks.length} chunks, watermark ${mark}`);
      }
    },
  );

  const tracked = await trackedTokens(ctx.db, to);
  const tokenFrom = Math.max(from, ((await getCursor(ctx.db, TOKEN_CURSOR)) ?? from - 1) + 1);
  const tokenChunks = chunkRange(tokenFrom, to, ctx.logsRange);
  let logged2 = 0;
  log(`[indexer] pass 2 transfers/swaps for ${tracked.length} tokens: ${tokenChunks.length} chunks from ${tokenFrom}`);
  await runChunks(
    tokenChunks,
    concurrency,
    async (a, b) => void (await indexTokenRange(ctx, a, b, tracked)),
    async (mark, n) => {
      await setCursor(ctx.db, TOKEN_CURSOR, mark);
      if (n - logged2 >= 100 || n === tokenChunks.length) {
        logged2 = n;
        log(`[indexer] pass 2: ${n}/${tokenChunks.length} chunks, watermark ${mark}`);
      }
    },
  );
  await setCursor(ctx.db, INDEXER_CURSOR, to);
}

/** Index [from, to] sequentially, advancing the cursor after each chunk (live tail). */
export async function indexBlocks(ctx: IndexerCtx, from: number, to: number): Promise<RangeStats> {
  let total = emptyStats();
  for (const [a, b] of chunkRange(from, to, ctx.logsRange)) {
    total = addStats(total, await indexRange(ctx, a, b));
    await setCursor(ctx.db, INDEXER_CURSOR, b);
  }
  if (total.trades || total.creates || total.transfers || total.swaps) {
    ctx.log?.(`[indexer] ${from}..${to}: ${JSON.stringify(total)}`);
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
