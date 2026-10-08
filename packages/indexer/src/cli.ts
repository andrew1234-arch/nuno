import { AddressBook, RpcClient, blockAtTimestamp, getBlockNumber, sleep } from "@nuno/shared";
import { config, openLocal } from "@nuno/shared/node";
import {
  CURVE_CURSOR,
  INDEXER_CURSOR,
  TOKEN_CURSOR,
  WINDOW_CURSOR,
  backfill,
  backfillTxSigners,
  countRows,
  getCursor,
  indexBlocks,
  setCursor,
} from "./indexer.js";

// Blocks behind head we treat as final before indexing.
const SAFE_LAG = 10;

// usage: tsx src/cli.ts backfill|tail|signers   (writes the local SQLite file, SPEC §7.10)
async function main() {
  const mode = process.argv[2];
  if (mode !== "backfill" && mode !== "tail" && mode !== "signers") throw new Error("usage: cli.ts backfill|tail|signers");

  const { db, close } = openLocal(config.localDbPath);
  const logsRpc = new RpcClient({ url: config.mainnetLogsRpcUrls, maxConcurrency: 8, cacheSize: 20_000 });
  const ctx = { db, book: new AddressBook(db), logsRpc, logsRange: config.logsRange, log: console.log };

  if (mode === "signers") {
    console.log(`[indexer] resolved tx signers for ${await backfillTxSigners(ctx)} transactions`);
    close();
    return;
  }

  const head = (await getBlockNumber(logsRpc)) - SAFE_LAG;
  if (mode === "backfill") {
    // Days may be fractional (e.g. BACKFILL_DAYS=1 for a size-projection run).
    const startTs = Math.floor(Date.now() / 1000 - config.backfillDays * 86400);
    const windowStart = await blockAtTimestamp(logsRpc, startTs, head);
    // Pass cursors make this resumable. Widening the window resets them so older blocks get indexed.
    const prevStart = await getCursor(db, WINDOW_CURSOR);
    if (prevStart === null || windowStart < prevStart) {
      await setCursor(db, CURVE_CURSOR, windowStart - 1);
      await setCursor(db, TOKEN_CURSOR, windowStart - 1);
      await setCursor(db, WINDOW_CURSOR, windowStart);
    }
    console.log(`[indexer] backfill ${windowStart}..${head} (${head - windowStart + 1} blocks) into ${config.localDbPath}`);
    await backfill(ctx, windowStart, head);
    await backfillTxSigners(ctx);
    console.log("[indexer] counts", await countRows(db));
    close();
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
