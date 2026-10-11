import { AddressBook, RpcClient } from "@nuno/shared";
import { config, openLocal } from "@nuno/shared/node";
import { getCursor } from "@nuno/indexer";
import { infrastructureSet } from "./infrastructure.js";
import { fullRun } from "./store.js";

// pnpm cluster:full / metrics:full — local full recompute of entities + metrics.
async function main() {
  const { db, close } = openLocal(config.localDbPath);
  const sourceBlock = await getCursor(db, "indexer");
  if (sourceBlock === null) throw new Error("no indexer cursor: run pnpm backfill:local first");
  const rpc = new RpcClient({ url: config.mainnetRpcUrl, maxConcurrency: 6, cacheSize: 20_000 });
  const run = await fullRun({ db, book: new AddressBook(db), rpc, infrastructure: infrastructureSet(), log: console.log }, sourceBlock);
  const rows = run.tokens
    .map(({ symbol, metrics: m, entities }) => ({
      symbol,
      token: m.token.slice(0, 10),
      rawHolders: m.rawHolders,
      realHolders: m.realHolders,
      entities,
      clusterBps: m.clusterSupplyBps,
      creatorBps: m.creatorLinkedSupplyBps,
      top10Bps: m.effectiveTop10Bps,
      rawVolMON: Number(m.rawVolume / 10n ** 15n) / 1000,
      organicBps: m.organicVolumeBps,
    }))
    .sort((a, b) => b.rawVolMON - a.rawVolMON);
  console.table(rows.slice(0, 30));
  console.log(`[metrics] ${rows.length} tokens, ${run.entities} multi-wallet entities at block ${sourceBlock}`);
  close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
