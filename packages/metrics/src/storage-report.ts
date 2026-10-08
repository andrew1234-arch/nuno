import { statSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { MONAD_SECONDS_PER_BLOCK, scalar, sqliteSchema as s } from "@nuno/shared";
import { config, openLocal } from "@nuno/shared/node";
import { budgetLevel, projectBytes, type Budget } from "./storage.js";

// pnpm storage:report — size + row counts of the local DB, projection for BACKFILL_DAYS, budget level.
// Writes a storage_stats row (SPEC §7.11).
const budget: Budget = {
  targetBytes: Number(process.env.STORAGE_TARGET_BYTES || 1_500_000_000),
  alarmBytes: Number(process.env.STORAGE_ALARM_BYTES || 2_500_000_000),
  hardStopBytes: Number(process.env.STORAGE_HARD_STOP_BYTES || 3_000_000_000),
};

const TABLES = ["addresses", "tokens", "graduations", "curve_trades", "transfers", "dex_swaps", "wallets", "funding_edges", "link_evidence", "entity_members", "token_metrics", "snapshots", "labels", "storage_stats"];

async function main() {
  const { db, raw, close } = openLocal(config.localDbPath);
  raw.exec("pragma wal_checkpoint(truncate)");
  const pageBytes = await scalar(db, sql`select page_count * page_size from pragma_page_count(), pragma_page_size()`);
  const fileBytes = existsSync(config.localDbPath) ? statSync(config.localDbPath).size : 0;
  const rowCounts: Record<string, number> = {};
  for (const t of TABLES) rowCounts[t] = await scalar(db, sql.raw(`select count(*) from ${t}`));

  const windowStart = await scalar(db, sql`select block from cursors where name = 'indexer:window_start'`);
  const head = await scalar(db, sql`select block from cursors where name = 'indexer'`);
  const coveredDays = windowStart && head ? ((head - windowStart) * MONAD_SECONDS_PER_BLOCK) / 86400 : 0;
  const projected = coveredDays > 0 ? projectBytes(pageBytes, coveredDays, config.backfillDays) : null;

  await db.insert(s.storageStats).values({ at: Date.now(), bytes: pageBytes, rowCounts: JSON.stringify(rowCounts) });
  console.log(JSON.stringify({ file: config.localDbPath, pageBytes, fileBytes, coveredDays: Number(coveredDays.toFixed(2)), rowCounts }, null, 2));
  console.log(`[storage] level now: ${budgetLevel(pageBytes, budget)} (target ${budget.targetBytes.toLocaleString("en-US")} B)`);
  if (projected !== null) {
    console.log(`[storage] projected for BACKFILL_DAYS=${config.backfillDays}: ${projected.toLocaleString("en-US")} B -> ${budgetLevel(projected, budget)}`);
    if (projected > budget.targetBytes) {
      console.log("[storage] PROJECTION OVER TARGET: shrink BACKFILL_DAYS or raise MIN_BUYERS before the full backfill (SPEC §7.11).");
      process.exitCode = 2;
    }
  }
  close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
