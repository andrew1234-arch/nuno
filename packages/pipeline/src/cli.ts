import { execSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { pendingBuyers, resolveFundingTree } from "@nuno/funding";
import {
  CURVE_CURSOR,
  INDEXER_CURSOR,
  TOKEN_CURSOR,
  WINDOW_CURSOR,
  backfill,
  backfillTxSigners,
  countRows,
  getCursor,
  setCursor,
} from "@nuno/indexer";
import { fullRun } from "@nuno/metrics";
import { AddressBook, RpcClient, blockAtTimestamp, getBlockNumber } from "@nuno/shared";
import { ROOT_DIR, config, openLocal } from "@nuno/shared/node";
import { exportStatic } from "./export.js";
import { infrastructure } from "./infra.js";
import { settingsFromEnv } from "./settings.js";
import { METRICS_CURSOR, dailyPrune, dbBytes, recordStorage, tick } from "./tick.js";

// pnpm backfill:local | tick | recluster | export:static — the same code GitHub Actions runs.
const SAFE_LAG = 10;
const DATA_COMMITTED_AT = "data:committed_at";
const LAST_PRUNE_AT = "prune:last_at";
const HOUR = 3_600_000;

/** Write `key=value` to $GITHUB_OUTPUT when running in Actions (and always to stdout). */
function output(key: string, value: string) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function rpcs() {
  return {
    logsRpc: new RpcClient({ url: config.mainnetLogsRpcUrls, maxConcurrency: 6, cacheSize: 20_000 }),
    archiveRpc: new RpcClient({ url: config.mainnetRpcUrl, maxConcurrency: 6, timeoutMs: 60_000, cacheSize: 20_000 }),
  };
}

async function main() {
  const cmd = process.argv[2];
  const cfg = settingsFromEnv();
  const { db, raw, close } = openLocal(config.localDbPath);
  const book = new AddressBook(db);
  // WAL must be folded into the main file before it is gzipped and committed.
  const checkpointWal = () => raw.exec("pragma wal_checkpoint(truncate)");

  try {
    if (cmd === "backfill") {
      // Time-boxed for GitHub Actions (6 h job limit): stop cleanly, checkpoint every 20 min.
      const deadline = Date.now() + Number(process.env.BACKFILL_MAX_MINUTES || 330) * 60_000;
      const shouldStop = () => Date.now() >= deadline;
      const checkpointCmd = process.env.CHECKPOINT_CMD; // e.g. scripts/commit-data.sh in backfill.yml
      const onCheckpoint = async () => {
        checkpointWal();
        if (checkpointCmd) execSync(checkpointCmd, { stdio: "inherit", cwd: ROOT_DIR });
      };
      const { logsRpc, archiveRpc } = rpcs();
      const head = (await getBlockNumber(logsRpc)) - SAFE_LAG;
      const windowStart = await blockAtTimestamp(logsRpc, Math.floor(Date.now() / 1000 - cfg.backfillDays * 86400), head);
      const prevStart = await getCursor(db, WINDOW_CURSOR);
      if (prevStart === null || windowStart < prevStart) {
        await setCursor(db, CURVE_CURSOR, windowStart - 1);
        await setCursor(db, TOKEN_CURSOR, windowStart - 1);
        await setCursor(db, WINDOW_CURSOR, windowStart);
      }
      // Resume an interrupted window up to its original end, not the new head.
      const target = (await getCursor(db, "backfill:target")) ?? head;
      await setCursor(db, "backfill:target", target);
      const ctx = { db, book, logsRpc, logsRange: cfg.logsRange, log: console.log };
      console.log(`[backfill] window ${windowStart}..${target} into ${config.localDbPath}`);
      const done = await backfill(ctx, windowStart, target, 8, { shouldStop, onCheckpoint, checkpointEveryMs: Number(process.env.CHECKPOINT_MINUTES || 20) * 60_000 });
      await backfillTxSigners(ctx);
      if (done) {
        const buyers = await pendingBuyers({ db, book }, 1_000_000);
        console.log(`[backfill] resolving funding for ${buyers.length} buyers`);
        // Parallel workers (the resolver shares in-flight lookups, so common funders are resolved once).
        let next = 0;
        const worker = async () => {
          while (next < buyers.length && !shouldStop()) {
            const b = buyers[next++]!;
            await resolveFundingTree({ db, book, rpc: archiveRpc, log: console.log }, b.trader, b.firstBuy - 1, 3);
          }
        };
        await Promise.all(Array.from({ length: Number(process.env.FUNDING_CONCURRENCY || 6) }, worker));
      }
      const complete = done && !shouldStop() && (await pendingBuyers({ db, book }, 1)).length === 0;
      if (complete) {
        const run = await fullRun({ db, book, rpc: archiveRpc, infrastructure: await infrastructure(db, book), log: console.log }, target);
        await setCursor(db, METRICS_CURSOR, target);
        await db.run(sql`delete from cursors where name = 'backfill:target'`);
        console.log(`[backfill] complete: ${run.tokens.length} tokens, ${run.entities} entities`);
      }
      await recordStorage(db, cfg, 0);
      console.log("[backfill] counts", await countRows(db));
      output("complete", complete ? "true" : "false");
      output("next_cursor", JSON.stringify({ curve: await getCursor(db, CURVE_CURSOR), tokens: await getCursor(db, TOKEN_CURSOR), target }));
    } else if (cmd === "tick") {
      const started = Date.now();
      const out = await tick(db, cfg, rpcs());
      // Daily prune (+ VACUUM) inside the tick, once per 24 h.
      const lastPrune = (await getCursor(db, LAST_PRUNE_AT)) ?? 0;
      if (Date.now() - lastPrune >= 24 * HOUR) {
        out.prune = await dailyPrune(db, cfg);
        await setCursor(db, LAST_PRUNE_AT, Date.now());
      }
      // Anti-bloat: commit the data branch only on real activity, or hourly so cursors keep moving.
      const idx = out.indexed as { trades?: number; creates?: number; transfers?: number; swaps?: number } | undefined;
      const activity =
        !!idx && (idx.trades || idx.creates || idx.transfers || idx.swaps) ? true : Boolean(out.funded) || Boolean(out.published) || Boolean(out.prune) || Boolean((out.nansen as { creditsSpent?: number }).creditsSpent);
      const lastCommit = (await getCursor(db, DATA_COMMITTED_AT)) ?? 0;
      const commit = activity || Date.now() - lastCommit >= HOUR;
      if (commit) await setCursor(db, DATA_COMMITTED_AT, Date.now());
      checkpointWal();
      console.log(JSON.stringify({ cmd, ms: Date.now() - started, ...out }));
      output("commit", commit ? "true" : "false");
    } else if (cmd === "recluster") {
      const sourceBlock = await getCursor(db, INDEXER_CURSOR);
      if (sourceBlock === null) throw new Error("no indexer cursor: run the backfill first");
      const run = await fullRun({ db, book, rpc: rpcs().archiveRpc, infrastructure: await infrastructure(db, book), log: console.log }, sourceBlock);
      await setCursor(db, METRICS_CURSOR, sourceBlock);
      checkpointWal();
      console.log(`[recluster] ${run.tokens.length} tokens, ${run.entities} entities at block ${sourceBlock}`);
    } else if (cmd === "export") {
      checkpointWal();
      const outDir = resolve(ROOT_DIR, process.env.EXPORT_DIR || "site");
      const r = await exportStatic(db, outDir, { dbSizeBytes: await dbBytes(db, config.localDbPath), backfillDays: cfg.backfillDays, label: process.env.EXPORT_LABEL || undefined });
      console.log(`[export] ${r.files} files, ${r.bytes.toLocaleString("en-US")} bytes -> ${outDir}/api`);
    } else {
      throw new Error("usage: cli.ts backfill|tick|recluster|export");
    }
  } finally {
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
