import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import { config, createDb } from "@nuno/shared";
import { publishAll } from "./publisher.js";

function feedAddress(): Address {
  if (process.env.NUNO_FEED_ADDRESS) return process.env.NUNO_FEED_ADDRESS as Address;
  const file = resolve(import.meta.dirname, "../../../deployments/monad-testnet.json");
  if (!existsSync(file)) throw new Error("No NUNO_FEED_ADDRESS and no deployments/monad-testnet.json: run pnpm deploy:contracts");
  return (JSON.parse(readFileSync(file, "utf8")) as { NunoFeed: Address }).NunoFeed;
}

async function main() {
  const privateKey = process.env.PUBLISHER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) throw new Error("PUBLISHER_PRIVATE_KEY is not set");
  const { db, sql } = createDb();
  const results = await publishAll({
    db,
    rpcUrl: config.testnetRpcUrl,
    chainId: Number(process.env.PUBLISH_CHAIN_ID ?? 10143),
    feed: feedAddress(),
    privateKey,
    log: console.log,
  });
  const sent = results.filter((r) => r.txHash);
  console.log(`[publisher] ${sent.length} published, ${results.length - sent.length} skipped`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
