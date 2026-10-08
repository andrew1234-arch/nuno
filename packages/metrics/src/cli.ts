import { RpcClient, config, createDb, getCursorBlock } from "@nuno/shared";
import { runAll, storeRun } from "./pipeline.js";
import { infrastructureSet } from "./infrastructure.js";

// Global entity resolution + per-token metrics over everything indexed so far.
async function main() {
  const { db, sql } = createDb();
  const rpc = new RpcClient({ url: config.mainnetRpcUrl, maxConcurrency: 6 });
  const sourceBlock = await getCursorBlock(db, "indexer");
  if (sourceBlock === null) throw new Error("no indexer cursor: run pnpm index:backfill first");

  const run = await runAll({ db, rpc, infrastructure: infrastructureSet(), log: console.log }, sourceBlock);
  await storeRun(db, run);

  console.log(`[metrics] ${run.result.clusters.length} multi-wallet entities; largest:`);
  console.table(
    run.result.clusters.slice(0, 10).map((c) => ({
      id: c.id.slice(0, 12),
      wallets: c.members.length,
      tokensCreated: c.createdTokens.length,
      edgeTypes: [...new Set(c.links.map((l) => l.type))].join(","),
    })),
  );
  const rows = run.tokens
    .map(({ symbol, token, clusterCount, metrics: m }) => ({
      symbol,
      token: token.slice(0, 10),
      rawHolders: m.rawHolders,
      realHolders: m.realHolders,
      entities: clusterCount,
      clusterBps: m.clusterSupplyBps,
      creatorBps: m.creatorLinkedSupplyBps,
      top10Bps: m.effectiveTop10Bps,
      rawVolMON: Number(m.rawVolume / 10n ** 15n) / 1000,
      organicBps: m.organicVolumeBps,
    }))
    .sort((a, b) => b.rawVolMON - a.rawVolMON);
  console.table(rows.slice(0, 30));
  console.log(`[metrics] ${rows.length} tokens at source block ${sourceBlock}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
