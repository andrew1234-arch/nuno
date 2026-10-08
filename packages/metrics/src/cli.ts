import { RpcClient, config, createDb, getCursorBlock } from "@nuno/shared";
import { allTokens, runToken, storeRun } from "./pipeline.js";
import { MANUAL_INFRASTRUCTURE } from "./infrastructure.js";

// usage: tsx src/cli.ts [token...]   (default: every tracked token)
async function main() {
  const { db, sql } = createDb();
  const rpc = new RpcClient({ url: config.mainnetRpcUrl, maxConcurrency: 6 });
  const sourceBlock = await getCursorBlock(db, "indexer");
  if (sourceBlock === null) throw new Error("no indexer cursor: run pnpm index:backfill first");

  const tokens = process.argv.length > 2 ? process.argv.slice(2).map((a) => a.toLowerCase()) : await allTokens(db);
  const ctx = { db, rpc, infrastructure: new Set(MANUAL_INFRASTRUCTURE), log: console.log };
  const rows: Array<Record<string, string | number>> = [];
  for (const t of tokens) {
    const run = await runToken(ctx, t, sourceBlock);
    if (!run) continue;
    await storeRun(db, run);
    const m = run.metrics;
    rows.push({
      symbol: run.symbol,
      token: t.slice(0, 10),
      rawHolders: m.rawHolders,
      realHolders: m.realHolders,
      clusters: run.clusters.clusters.length,
      clusterBps: m.clusterSupplyBps,
      creatorBps: m.creatorLinkedSupplyBps,
      top10Bps: m.effectiveTop10Bps,
      rawVolMON: Number(m.rawVolume / 10n ** 15n) / 1000,
      organicBps: m.organicVolumeBps,
    });
  }
  rows.sort((a, b) => Number(b.rawVolMON) - Number(a.rawVolMON));
  console.table(rows);
  console.log(`[metrics] ${rows.length} tokens at source block ${sourceBlock}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
