import { RpcClient, blockAtTimestamp, config, createDb, getBlockNumber, sleep } from "@nuno/shared";
import {
  CURVE_CURSOR,
  INDEXER_CURSOR,
  TOKEN_CURSOR,
  WINDOW_CURSOR,
  backfill,
  countRows,
  getCursor,
  indexBlocks,
  setCursor,
} from "./indexer.js";

// Blocks behind head we treat as final before indexing.
const SAFE_LAG = 10;

async function main() {
  const mode = process.argv[2];
  if (mode !== "backfill" && mode !== "tail") throw new Error("usage: cli.ts backfill|tail");

  const { db, sql } = createDb();
  const logsRpc = new RpcClient({ url: config.mainnetLogsRpcUrl, maxConcurrency: 4 });
  const ctx = { db, logsRpc, logsRange: config.logsRange, log: console.log };

  const head = (await getBlockNumber(logsRpc)) - SAFE_LAG;
  if (mode === "backfill") {
    // Days may be fractional (e.g. BACKFILL_DAYS=1 for a Gate A run).
    const startTs = Math.floor(Date.now() / 1000 - config.backfillDays * 86400);
    const windowStart = await blockAtTimestamp(logsRpc, startTs, head);
    // Pass cursors make this resumable. Widening the window resets them so older blocks get indexed.
    const prevStart = await getCursor(db, WINDOW_CURSOR);
    if (prevStart === null || windowStart < prevStart) {
      await setCursor(db, CURVE_CURSOR, windowStart - 1);
      await setCursor(db, TOKEN_CURSOR, windowStart - 1);
      await setCursor(db, WINDOW_CURSOR, windowStart);
    }
    console.log(`[indexer] backfill ${windowStart}..${head} (${head - windowStart + 1} blocks)`);
    await backfill(ctx, windowStart, head);
    console.log("[indexer] counts", await countRows(db));
    await sql.end();
    return;
  }

  const cursor = await getCursor(db, INDEXER_CURSOR);
  if (cursor === null) throw new Error("no cursor: run backfill first");
  let next = cursor + 1;
  for (;;) {
    const tip = (await getBlockNumber(logsRpc)) - SAFE_LAG;
    if (tip >= next) {
      await indexBlocks(ctx, next, tip);
      next = tip + 1;
    }
    await sleep(2_000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
