import { RpcClient, config, createDb } from "@nuno/shared";
import { pendingBuyers, resolveFundingTree } from "./resolver.js";

// usage: tsx src/cli.ts [limit] [maxHops]
async function main() {
  const limit = Number(process.argv[2] ?? 1_000_000);
  const maxHops = Number(process.argv[3] ?? 3);
  const { db, sql } = createDb();
  const rpc = new RpcClient({ url: config.mainnetRpcUrl, maxConcurrency: 6, timeoutMs: 60_000 });

  const buyers = await pendingBuyers(db, limit);
  console.log(`[funding] resolving ${buyers.length} buyer wallets (maxHops=${maxHops})`);
  let i = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (i < buyers.length) {
      const b = buyers[i++];
      if (!b) break;
      // Funding must precede the first buy, so search strictly before it.
      await resolveFundingTree({ db, rpc, log: console.log }, b.trader, b.firstBuy - 1, maxHops);
    }
  });
  await Promise.all(workers);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
