import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  AddressBook,
  NADFUN_CURVE_V2,
  NADFUN_MAINNET,
  TOPICS,
  chunkRange,
  chunks,
  insertIgnore,
  scalar,
  sqliteSchema as s,
  toHex,
  txBytes,
  txHex,
  type RpcClient,
  type RpcLog,
  type SqlDb,
} from "@nuno/shared";
import { decodeCurveLog, decodeSwapLog, decodeTransferLog, logMeta } from "./decode.js";

export const INDEXER_CURSOR = "indexer";
export const CURVE_CURSOR = "indexer:curve";
export const TOKEN_CURSOR = "indexer:tokens";
/** First block of the backfill window currently covered. */
export const WINDOW_CURSOR = "indexer:window_start";
const ADDRESS_BATCH = 50;

export interface IndexerCtx {
  db: SqlDb;
  book: AddressBook;
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

const emptyStats = (): RangeStats => ({ creates: 0, trades: 0, graduations: 0, transfers: 0, swaps: 0 });

function addStats(a: RangeStats, b: RangeStats): RangeStats {
  const out = emptyStats();
  for (const k of Object.keys(out) as Array<keyof RangeStats>) out[k] = a[k] + b[k];
  return out;
}

async function getLogs(rpc: RpcClient, filter: { address?: string | string[]; topics?: unknown[] }, from: number, to: number) {
  return rpc.call<RpcLog[]>("eth_getLogs", [{ ...filter, fromBlock: toHex(from), toBlock: toHex(to) }]);
}

/** Transaction signer (tx.from), lowercase. Cached per tx; null results are never cached. */
export async function txSigner(rpc: RpcClient, txHash: string): Promise<string> {
  // A lagging node in the round-robin can briefly return null for a tx that exists; retry before failing.
  for (let attempt = 0; attempt < 5; attempt++) {
    const tx = await rpc.call<{ from: string } | null>("eth_getTransactionByHash", [txHash], { cache: true });
    if (tx) return tx.from.toLowerCase();
    await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
  }
  throw new Error(`transaction ${txHash} not found`);
}

/** Curve events (creates, trades, graduations) of both nad.fun curves (V1 and V2) for one log-range-sized chunk. Idempotent. */
export async function indexCurveRange(ctx: IndexerCtx, from: number, to: number): Promise<RangeStats> {
  const { db, book, logsRpc } = ctx;
  const stats = emptyStats();
  const curveLogs = await getLogs(
    logsRpc,
    {
      address: [NADFUN_MAINNET.CURVE, NADFUN_CURVE_V2],
      topics: [[TOPICS.CurveCreate, TOPICS.CurveBuy, TOPICS.CurveSell, TOPICS.CurveGraduate, TOPICS.V2Create, TOPICS.V2Buy, TOPICS.V2Sell]],
    },
    from,
    to,
  );
  const decoded = curveLogs.map((l) => ({ m: logMeta(l), r: decodeCurveLog(l) }));

  // Signers for trades (needed to attribute bot-contract trades to the wallet that signed them).
  const signers = new Map<string, string>();
  for (const h of new Set(decoded.filter((d) => d.r.kind === "trade").map((d) => d.m.txHash))) {
    signers.set(h, await txSigner(logsRpc, h));
  }

  const addrs: string[] = decoded.flatMap(({ r }) =>
    r.kind === "create" ? [r.token, r.creator, r.pool] : r.kind === "trade" ? [r.token, r.trader] : r.kind === "graduate" ? [r.token, r.pool] : [],
  );
  const ids = await book.ids([...addrs, ...signers.values()]);
  const id = (a: string) => ids.get(a.toLowerCase())!;

  const tokenRows: Array<typeof s.tokens.$inferInsert> = [];
  const tradeRows: Array<typeof s.curveTrades.$inferInsert> = [];
  const gradRows: Array<typeof s.graduations.$inferInsert> = [];
  for (const { m, r } of decoded) {
    if (r.kind === "create") {
      tokenRows.push({
        id: id(r.token),
        creator: id(r.creator),
        curvePool: id(r.pool),
        name: r.name,
        symbol: r.symbol,
        createBlock: m.block,
        createTx: txBytes(m.txHash),
      });
      stats.creates++;
    } else if (r.kind === "trade") {
      tradeRows.push({
        tx: txBytes(m.txHash),
        logIndex: m.logIndex,
        block: m.block,
        token: id(r.token),
        trader: id(r.trader),
        txFrom: id(signers.get(m.txHash)!),
        side: s.SIDE[r.side],
        amountIn: r.amountIn.toString(),
        amountOut: r.amountOut.toString(),
      });
      stats.trades++;
    } else if (r.kind === "graduate") {
      gradRows.push({ token: id(r.token), pool: id(r.pool), block: m.block, tx: txBytes(m.txHash) });
      stats.graduations++;
    }
  }
  await insertIgnore(db, s.tokens, tokenRows);
  await insertIgnore(db, s.curveTrades, tradeRows);
  await insertIgnore(db, s.graduations, gradRows);
  return stats;
}

/** Copy stored graduations onto their tokens. Idempotent; safe after out-of-order chunks. */
export async function applyGraduations(db: SqlDb): Promise<void> {
  await db.run(sql`
    update tokens set
      graduated_pool = (select g.pool from graduations g where g.token = tokens.id),
      graduated_block = (select g.block from graduations g where g.token = tokens.id)
    where graduated_pool is null and id in (select token from graduations)`);
}

export interface TrackedToken {
  id: number;
  hex: string;
  pool: { id: number; hex: string } | null;
}

/** Tracked tokens = tokens whose CurveCreate we indexed (inside the window), not yet pruned. */
export async function trackedTokens(ctx: Pick<IndexerCtx, "db" | "book">, upToBlock: number): Promise<TrackedToken[]> {
  const rows = await ctx.db
    .select({ id: s.tokens.id, pool: s.tokens.graduatedPool })
    .from(s.tokens)
    .where(and(lte(s.tokens.createBlock, upToBlock), eq(s.tokens.pruned, 0)));
  const hex = await ctx.book.hexes(rows.flatMap((r) => (r.pool ? [r.id, r.pool] : [r.id])));
  return rows.map((r) => ({ id: r.id, hex: hex.get(r.id)!, pool: r.pool ? { id: r.pool, hex: hex.get(r.pool)! } : null }));
}

/** ERC-20 Transfers of tracked tokens and Swaps on their graduated pools for one chunk. Idempotent. */
export async function indexTokenRange(ctx: IndexerCtx, from: number, to: number, tracked: TrackedToken[]): Promise<RangeStats> {
  const { db, book, logsRpc } = ctx;
  const stats = emptyStats();
  const tokenByHex = new Map(tracked.map((t) => [t.hex.toLowerCase(), t.id]));

  for (const batch of chunks(tracked, ADDRESS_BATCH)) {
    const logs = await getLogs(logsRpc, { address: batch.map((t) => t.hex), topics: [TOPICS.Transfer] }, from, to);
    const decoded = logs.flatMap((l) => {
      const t = decodeTransferLog(l);
      return t ? [{ m: logMeta(l), t }] : [];
    });
    const ids = await book.ids(decoded.flatMap(({ t }) => [t.from, t.to]));
    const rows = decoded.map(({ m, t }) => ({
      tx: txBytes(m.txHash),
      logIndex: m.logIndex,
      block: m.block,
      token: tokenByHex.get(t.token)!,
      from: ids.get(t.from)!,
      to: ids.get(t.to)!,
      value: t.value.toString(),
    }));
    await insertIgnore(db, s.transfers, rows);
    stats.transfers += rows.length;
  }

  const pools = tracked.filter((t): t is TrackedToken & { pool: { id: number; hex: string } } => t.pool !== null);
  const byPool = new Map(pools.map((p) => [p.pool.hex.toLowerCase(), p]));
  for (const batch of chunks(pools, ADDRESS_BATCH)) {
    const logs = await getLogs(logsRpc, { address: batch.map((p) => p.pool.hex) }, from, to);
    const decoded = logs.flatMap((l) => {
      const sw = decodeSwapLog(l);
      const tok = sw && byPool.get(sw.pool);
      return sw && tok ? [{ m: logMeta(l), sw, tok }] : [];
    });
    // The swap sender is the router: store the signer so DEX volume is attributed to the trader.
    const signers = new Map<string, string>();
    for (const h of new Set(decoded.map((d) => d.m.txHash))) signers.set(h, await txSigner(logsRpc, h));
    const ids = await book.ids([...decoded.flatMap(({ sw }) => [sw.sender, sw.recipient]), ...signers.values()]);
    const rows = decoded.map(({ m, sw, tok }) => ({
      tx: txBytes(m.txHash),
      logIndex: m.logIndex,
      block: m.block,
      pool: tok.pool.id,
      token: tok.id,
      sender: ids.get(sw.sender)!,
      recipient: ids.get(sw.recipient)!,
      txFrom: ids.get(signers.get(m.txHash)!)!,
      amount0: sw.amount0.toString(),
      amount1: sw.amount1.toString(),
    }));
    await insertIgnore(db, s.dexSwaps, rows);
    stats.swaps += rows.length;
  }
  return stats;
}

/** Both passes for one chunk, in order (used by the live tail). */
export async function indexRange(ctx: IndexerCtx, from: number, to: number): Promise<RangeStats> {
  const a = await indexCurveRange(ctx, from, to);
  await applyGraduations(ctx.db);
  const b = await indexTokenRange(ctx, from, to, await trackedTokens(ctx, to));
  return addStats(a, b);
}

export async function getCursor(db: SqlDb, name: string): Promise<number | null> {
  const rows = await db.select().from(s.cursors).where(eq(s.cursors.name, name));
  return rows[0]?.block ?? null;
}

export async function setCursor(db: SqlDb, name: string, block: number): Promise<void> {
  const updatedAt = Date.now();
  await db
    .insert(s.cursors)
    .values({ name, block, updatedAt })
    .onConflictDoUpdate({ target: s.cursors.name, set: { block, updatedAt } });
}

/**
 * Run `fn` over chunks with bounded concurrency. Calls `onDone(block)` with the highest block
 * such that every chunk up to it has completed, so a cursor saved there is always safe to resume from.
 */
export async function runChunks(
  chunkList: Array<[number, number]>,
  concurrency: number,
  fn: (from: number, to: number) => Promise<void>,
  onDone: (watermark: number, completed: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  const done = new Array<boolean>(chunkList.length).fill(false);
  let next = 0;
  let low = 0; // first chunk index not yet known complete
  let completed = 0;
  let flushing = Promise.resolve();
  const worker = async () => {
    // Stop taking new chunks when asked; in-flight chunks finish so the watermark stays valid.
    while (next < chunkList.length && !shouldStop()) {
      const i = next++;
      const [a, b] = chunkList[i]!;
      await fn(a, b);
      done[i] = true;
      completed++;
      if (i === low) {
        while (low < chunkList.length && done[low]) low++;
        const mark = chunkList[low - 1]![1];
        const c = completed;
        flushing = flushing.then(() => onDone(mark, c));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, chunkList.length) }, worker));
  await flushing;
}

/**
 * Backfill [from, to] in two resumable, parallel passes:
 *  1. curve events (defines the tracked token set),
 *  2. transfers + swaps for every token tracked by the end of pass 1.
 * Afterwards the shared INDEXER_CURSOR is set to `to` for the live tail.
 */
export interface BackfillControl {
  /** Checked between chunks; when true, the backfill stops cleanly at a resumable watermark. */
  shouldStop?: () => boolean;
  /** Called (awaited) at most every `checkpointEveryMs`, after a cursor was saved. */
  onCheckpoint?: () => Promise<void>;
  checkpointEveryMs?: number;
}

/** Returns true when both passes completed, false when stopped early (re-run to resume). */
export async function backfill(ctx: IndexerCtx, from: number, to: number, concurrency = 8, control: BackfillControl = {}): Promise<boolean> {
  const stop = control.shouldStop ?? (() => false);
  let lastCheckpoint = Date.now();
  const maybeCheckpoint = async () => {
    if (control.onCheckpoint && Date.now() - lastCheckpoint >= (control.checkpointEveryMs ?? Infinity)) {
      lastCheckpoint = Date.now();
      await control.onCheckpoint();
    }
  };
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
      await maybeCheckpoint();
    },
    stop,
  );
  if (stop()) return false;

  // Pass 1 ran chunks out of order: attach graduations now that every create is stored.
  await applyGraduations(ctx.db);
  const tracked = await trackedTokens(ctx, to);
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
      await maybeCheckpoint();
    },
    stop,
  );
  if (stop()) return false;
  await setCursor(ctx.db, INDEXER_CURSOR, to);
  return true;
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

/** Fill tx_from for trades stored without it (older data). Resumable: only touches NULL rows. */
export async function backfillTxSigners(ctx: IndexerCtx, concurrency = 6): Promise<number> {
  const rows = await ctx.db.selectDistinct({ tx: s.curveTrades.tx }).from(s.curveTrades).where(isNull(s.curveTrades.txFrom));
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < rows.length) {
        const { tx } = rows[i++]!;
        const from = await ctx.book.id(await txSigner(ctx.logsRpc, txHex(tx)));
        await ctx.db.update(s.curveTrades).set({ txFrom: from }).where(eq(s.curveTrades.tx, tx));
      }
    }),
  );
  // Swaps indexed before the tx_from column existed.
  const swaps = await ctx.db.selectDistinct({ tx: s.dexSwaps.tx }).from(s.dexSwaps).where(isNull(s.dexSwaps.txFrom));
  for (const { tx } of swaps) {
    const from = await ctx.book.id(await txSigner(ctx.logsRpc, txHex(tx)));
    await ctx.db.update(s.dexSwaps).set({ txFrom: from }).where(eq(s.dexSwaps.tx, tx));
  }
  return rows.length + swaps.length;
}

export async function countRows(db: SqlDb): Promise<Record<string, number>> {
  const tables = ["addresses", "tokens", "graduations", "curve_trades", "transfers", "dex_swaps", "wallets", "funding_edges", "link_evidence", "entity_members", "token_metrics", "snapshots"];
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = await scalar(db, sql.raw(`select count(*) from ${t}`));
  return out;
}
