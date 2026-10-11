import { statSync, existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { MONAD_SECONDS_PER_BLOCK, scalar, sqliteSchema as s } from "@nuno/shared";
import { config, openLocal } from "@nuno/shared/node";
import { budgetFromEnv, budgetLevel, projectBytes } from "./storage.js";

// pnpm storage:report — file size + row counts of data/nuno.sqlite, projection for BACKFILL_DAYS,
// budget level (target 40 MB, alarm 70 MB, hard stop 90 MB). Writes a storage_stats row.
const budget = budgetFromEnv(process.env);

const TABLES = ["addresses", "tokens", "graduations", "curve_trades", "transfers", "dex_swaps", "wallets", "funding_edges", "link_evidence", "entity_members", "token_metrics", "snapshots", "labels", "nansen_cache", "storage_stats"];

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
  console.log(`[storage] file ${fileBytes.toLocaleString("en-US")} B, level ${budgetLevel(Math.max(pageBytes, fileBytes), budget)} (target ${budget.targetBytes.toLocaleString("en-US")} B, alarm ${budget.alarmBytes.toLocaleString("en-US")}, hard stop ${budget.hardStopBytes.toLocaleString("en-US")})`);
  if (projected !== null) {
    console.log(`[storage] projected for BACKFILL_DAYS=${config.backfillDays}: ${projected.toLocaleString("en-US")} B -> ${budgetLevel(projected, budget)}`);
    if (projected > budget.targetBytes) {
      console.log("[storage] PROJECTION OVER TARGET: shrink BACKFILL_DAYS or raise MIN_BUYERS before the full backfill.");
      process.exitCode = 2;
    }
  }
  close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
