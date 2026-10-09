import { eq, gt } from "drizzle-orm";
import { pendingBuyers, resolveFundingTree } from "@nuno/funding";
import { INDEXER_CURSOR, WINDOW_CURSOR, getCursor, indexBlocks, prune, setCursor } from "@nuno/indexer";
import { budgetLevel, incrementalRun, infrastructureSet } from "@nuno/metrics";
import { publishAll } from "@nuno/publisher";
import { AddressBook, MONAD_SECONDS_PER_BLOCK, RpcClient, getBlockNumber, sqliteSchema as s, type SqlDb } from "@nuno/shared";
import type { Settings } from "./env.js";

/**
 * Cron handlers. Each run does a bounded amount of work and saves cursors, so a run that stops
 * early (limits, errors) is simply continued by the next one (CLAUDE.md conventions).
 * Limits checked 2026-10-08: cron <1 h = 30 s CPU, 15 min wall, 10k subrequests,
 * 6 simultaneous connections; D1 = 1,000 queries/invocation, 100 params/query.
 */
const SAFE_LAG = 10;
/** Max blocks indexed per tick (10 log chunks at 100 blocks): catch-up spreads over several ticks. */
const MAX_BLOCKS_PER_TICK = 1_000;
/** Max new buyers resolved per tick (~60 archive calls each incl. hops). */
const MAX_FUNDING_PER_TICK = 5;
export const METRICS_CURSOR = "metrics";
/** Set (block = 1) when D1 reaches the hard-stop size: the tail stops inserting raw events. */
export const HARD_STOP_FLAG = "storage:hard_stop";

const log = (msg: string) => console.log(msg);

export function clients(cfg: Settings): { logsRpc: RpcClient; archiveRpc: RpcClient } {
  return {
    logsRpc: new RpcClient({ url: cfg.logsRpcUrls, maxConcurrency: 3, cacheSize: 2_000, timeoutMs: 20_000, retries: 3 }),
    archiveRpc: new RpcClient({ url: cfg.archiveRpcUrl, maxConcurrency: 3, cacheSize: 2_000, timeoutMs: 20_000, retries: 3 }),
  };
}

export async function tick(db: SqlDb, cfg: Settings, rpcs = clients(cfg)): Promise<Record<string, unknown>> {
  const book = new AddressBook(db);
  const { logsRpc, archiveRpc } = rpcs;
  const out: Record<string, unknown> = {};

  const hardStop = (await getCursor(db, HARD_STOP_FLAG)) === 1;
  const cursor = await getCursor(db, INDEXER_CURSOR);
  if (cursor === null) return { skipped: "no indexer cursor: import the local backfill first (pnpm d1:import)" };

  // 1. Tail (bounded). Skipped at the storage hard stop; metrics/publisher keep running (SPEC §7.11).
  let head = cursor;
  if (!hardStop) {
    const tip = (await getBlockNumber(logsRpc)) - SAFE_LAG;
    const to = Math.min(tip, cursor + MAX_BLOCKS_PER_TICK);
    if (to > cursor) {
      out.indexed = await indexBlocks({ db, book, logsRpc, logsRange: cfg.logsRange, log }, cursor + 1, to);
      head = to;
    }
  } else out.hardStop = true;

  // 2. Funding for new buyers (bounded; never-tried first).
  const buyers = await pendingBuyers({ db, book }, MAX_FUNDING_PER_TICK);
  for (const b of buyers) await resolveFundingTree({ db, book, rpc: archiveRpc, log }, b.trader, b.firstBuy - 1, 3);
  out.funded = buyers.length;

  // 3. Incremental entities + metrics since the last *completed* metrics run. "Newly funded" is read
  // from the DB (resolved after that run), so a tick that failed after funding is picked up next time.
  const [mc] = await db.select().from(s.cursors).where(eq(s.cursors.name, METRICS_CURSOR));
  const since = mc?.block ?? cursor;
  const lastRunAt = mc?.updatedAt ?? 0;
  const newlyFunded = (await db.select({ id: s.wallets.id }).from(s.wallets).where(gt(s.wallets.resolvedAt, lastRunAt))).map((r) => r.id);
  if (head > since || newlyFunded.length) {
    const run = await incrementalRun({ db, book, rpc: archiveRpc, infrastructure: infrastructureSet(), log }, since, head, newlyFunded);
    await setCursor(db, METRICS_CURSOR, head);
    out.metrics = { tokens: run.tokens.length, newlyFunded: newlyFunded.length };
  }

  // 4. Publish changed snapshots (the publisher's policy decides per token).
  if (cfg.publisher) {
    const results = await publishAll({ db, book, ...cfg.publisher, log });
    out.published = results.filter((r) => r.txHash).length;
    out.publishFailed = results.filter((r) => r.error).length;
  }
  return out;
}

/** Hourly: record D1 size (`meta.size_after`) and set/clear the hard-stop flag (SPEC §7.11). */
export async function storageCheck(d1: D1Database, db: SqlDb, cfg: Settings): Promise<Record<string, unknown>> {
  const probe = await d1.prepare("select count(*) as n from addresses").run();
  const bytes = Number(probe.meta.size_after ?? 0);
  const tables = ["addresses", "tokens", "curve_trades", "transfers", "dex_swaps", "wallets", "funding_edges", "link_evidence", "entity_members", "token_metrics", "snapshots"];
  const rowCounts: Record<string, number> = {};
  for (const t of tables) rowCounts[t] = Number((await d1.prepare(`select count(*) as n from ${t}`).first<{ n: number }>())?.n ?? 0);
  await db.insert(s.storageStats).values({ at: Date.now(), bytes, rowCounts: JSON.stringify(rowCounts) });
  const level = budgetLevel(bytes, cfg.budget);
  await setCursor(db, HARD_STOP_FLAG, level === "hard_stop" ? 1 : 0);
  if (level === "alarm" || level === "hard_stop") {
    // Alarm: prune immediately and surface it in the logs for the user (SPEC §7.11 table).
    console.error(`[storage] ${level.toUpperCase()}: D1 is ${bytes} bytes (alarm ${cfg.budget.alarmBytes}, hard stop ${cfg.budget.hardStopBytes})`);
    await dailyPrune(db, cfg);
  }
  return { bytes, level, rowCounts };
}

/** Daily: prune tokens outside the window or below MIN_BUYERS, and old snapshots. */
export async function dailyPrune(db: SqlDb, cfg: Settings): Promise<Record<string, unknown>> {
  const head = (await getCursor(db, INDEXER_CURSOR)) ?? 0;
  const windowStart = Math.max((await getCursor(db, WINDOW_CURSOR)) ?? 0, head - Math.round((cfg.backfillDays * 86_400) / MONAD_SECONDS_PER_BLOCK));
  const r = await prune(db, { head, windowStartBlock: windowStart, minBuyers: cfg.minBuyers, nowMs: Date.now() });
  return { ...r };
}

