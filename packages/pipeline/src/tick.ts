import { statSync } from "node:fs";
import { eq, gt, sql } from "drizzle-orm";
import { pendingBuyers, resolveFundingTree } from "@nuno/funding";
import { INDEXER_CURSOR, WINDOW_CURSOR, getCursor, indexBlocks, prune, setCursor } from "@nuno/indexer";
import { budgetLevel, incrementalRun, type Budget } from "@nuno/metrics";
import { publishAll, type PublisherEnv } from "@nuno/publisher";
import { AddressBook, MONAD_SECONDS_PER_BLOCK, RpcClient, getBlockNumber, scalar, sqliteSchema as s, type SqlDb } from "@nuno/shared";
import { infrastructure } from "./infra.js";
import { Nansen, type NansenOptions } from "./nansen.js";
import { nansenChecks } from "./nansen-checks.js";

/**
 * One pipeline run (`pnpm tick` locally, `tick.yml` every ~10 min on GitHub Actions). Every step
 * is bounded and cursor-based, so a run that stops early is continued by the next one.
 * Overlap is prevented by the workflow's concurrency group (`tick`, no cancel-in-progress).
 */
export const METRICS_CURSOR = "metrics";
/** Set (block = 1) when the DB file reaches the hard stop: tail stops inserting raw events. */
export const HARD_STOP_FLAG = "storage:hard_stop";

export interface TickSettings {
  logsRange: number;
  backfillDays: number;
  minBuyers: number;
  budget: Budget;
  /** Max blocks indexed per run (a 10-minute interval is ~2,000 blocks; catch-up spreads over runs). */
  maxBlocksPerRun: number;
  /** Max new buyers funding-resolved per run (~60 archive calls each incl. hops). */
  maxFundingPerRun: number;
  /** Max snapshots published per run (sequential txs). */
  maxPublishPerRun: number;
  publisher: PublisherEnv | null;
  nansen: NansenOptions;
  /** Path of the SQLite file (for the size check); undefined for in-memory tests. */
  dbPath?: string;
}

export interface TickDeps {
  logsRpc: RpcClient;
  archiveRpc: RpcClient;
}

const SAFE_LAG = 10;
const log = (msg: string) => console.log(msg);

export async function tick(db: SqlDb, cfg: TickSettings, deps: TickDeps): Promise<Record<string, unknown>> {
  const book = new AddressBook(db);
  const { logsRpc, archiveRpc } = deps;
  const out: Record<string, unknown> = {};
  const runStartedAt = Date.now();

  const cursor = await getCursor(db, INDEXER_CURSOR);
  if (cursor === null) return { skipped: "no indexer cursor: run the backfill first" };

  // 0. Storage budget first: at the alarm, prune (+ VACUUM) before adding anything.
  const sizeBefore = await dbBytes(db, cfg.dbPath);
  const levelBefore = budgetLevel(sizeBefore, cfg.budget);
  if (levelBefore === "alarm" || levelBefore === "hard_stop") {
    console.error(`[storage] ${levelBefore.toUpperCase()}: DB is ${sizeBefore} bytes; pruning now`);
    out.alarmPrune = await dailyPrune(db, cfg);
  }
  const hardStop = budgetLevel(await dbBytes(db, cfg.dbPath), cfg.budget) === "hard_stop";
  await setCursor(db, HARD_STOP_FLAG, hardStop ? 1 : 0);

  // 1. Tail (bounded). Skipped at the hard stop; metrics, publishing and the site keep running.
  let head = cursor;
  if (!hardStop) {
    const tip = (await getBlockNumber(logsRpc)) - SAFE_LAG;
    const to = Math.min(tip, cursor + cfg.maxBlocksPerRun);
    if (to > cursor) {
      out.indexed = await indexBlocks({ db, book, logsRpc, logsRange: cfg.logsRange, log }, cursor + 1, to);
      head = to;
    }
    out.behindBlocks = Math.max(0, tip - head);
  } else out.hardStop = true;

  // 2. Funding for new buyers (bounded; never-tried first).
  const buyers = await pendingBuyers({ db, book }, cfg.maxFundingPerRun);
  for (const b of buyers) await resolveFundingTree({ db, book, rpc: archiveRpc, log }, b.trader, b.firstBuy - 1, 3);
  out.funded = buyers.length;

  // 3. Nansen hub/related-wallet checks (free-plan budget; cached forever). New infrastructure
  // labels feed the incremental run below.
  const nansen = new Nansen(db, book, { ...cfg.nansen, log });
  out.nansen = await nansenChecks(db, book, nansen, log);

  // 4. Incremental entities + metrics since the last completed metrics run. "Newly funded" is read
  // from the DB, so a run that failed after funding is picked up next time.
  let mc = (await db.select().from(s.cursors).where(eq(s.cursors.name, METRICS_CURSOR)))[0];
  if (!mc) {
    // No metrics cursor (e.g. right after an older backfill): everything up to `cursor` was covered
    // by the full run, so start from here instead of treating every resolved wallet as new.
    // Stamped with this run's start, so wallets resolved earlier in this run still count as new.
    await db.insert(s.cursors).values({ name: METRICS_CURSOR, block: cursor, updatedAt: runStartedAt });
    mc = (await db.select().from(s.cursors).where(eq(s.cursors.name, METRICS_CURSOR)))[0]!;
  }
  const newlyFunded = (await db.select({ id: s.wallets.id }).from(s.wallets).where(gt(s.wallets.resolvedAt, mc.updatedAt))).map((r) => r.id);
  if (head > mc.block || newlyFunded.length) {
    const run = await incrementalRun({ db, book, rpc: archiveRpc, infrastructure: await infrastructure(db, book), log }, mc.block, head, newlyFunded);
    await setCursor(db, METRICS_CURSOR, head);
    out.metrics = { tokens: run.tokens.length, newlyFunded: newlyFunded.length };
  }

  // 5. Publish changed snapshots (bounded; the publisher's policy decides per token).
  if (cfg.publisher) {
    const results = await publishAll({ db, book, ...cfg.publisher, log, maxPublishes: cfg.maxPublishPerRun });
    out.published = results.filter((r) => r.txHash).length;
    out.publishFailed = results.filter((r) => r.error).length;
  }

  // 6. Record size, row counts and Nansen credits for this run.
  out.storage = await recordStorage(db, cfg, nansen.spent);
  return out;
}

/** File size of the DB (after a checkpoint), or page bytes for in-memory DBs. */
export async function dbBytes(db: SqlDb, path?: string): Promise<number> {
  if (path) {
    try {
      return statSync(path).size;
    } catch {
      /* not created yet */
    }
  }
  return scalar(db, sql`select page_count * page_size from pragma_page_count(), pragma_page_size()`);
}

const TABLES = ["addresses", "tokens", "curve_trades", "transfers", "dex_swaps", "wallets", "funding_edges", "link_evidence", "entity_members", "token_metrics", "snapshots", "nansen_cache", "labels"];

export async function recordStorage(db: SqlDb, cfg: Pick<TickSettings, "budget" | "dbPath">, nansenCreditsSpent: number) {
  const bytes = await dbBytes(db, cfg.dbPath);
  const rowCounts: Record<string, number> = {};
  for (const t of TABLES) rowCounts[t] = await scalar(db, sql.raw(`select count(*) from ${t}`));
  await db.insert(s.storageStats).values({ at: Date.now(), bytes, rowCounts: JSON.stringify(rowCounts), nansenCreditsSpent });
  return { bytes, level: budgetLevel(bytes, cfg.budget), nansenCreditsSpent };
}

/** Prune tokens outside the window or below MIN_BUYERS and old snapshots, then VACUUM. */
export async function dailyPrune(db: SqlDb, cfg: Pick<TickSettings, "backfillDays" | "minBuyers">): Promise<Record<string, unknown>> {
  const head = (await getCursor(db, INDEXER_CURSOR)) ?? 0;
  const windowStart = Math.max((await getCursor(db, WINDOW_CURSOR)) ?? 0, head - Math.round((cfg.backfillDays * 86_400) / MONAD_SECONDS_PER_BLOCK));
  const r = await prune(db, { head, windowStartBlock: windowStart, minBuyers: cfg.minBuyers, nowMs: Date.now() });
  await db.run(sql`vacuum`);
  return { ...r, vacuumed: true };
}
