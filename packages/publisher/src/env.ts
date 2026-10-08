import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import { config } from "@nuno/shared/node";
import type { PublisherEnv } from "./publisher.js";

// Node-only: publisher settings from env / deployments file (the Worker reads its own bindings).
const DEPLOYMENTS = resolve(import.meta.dirname, "../../../deployments/monad-testnet.json");

/**
 * Publisher settings from env (single source for the local CLI). Returns null, with the reason,
 * when publishing is not configured.
 */
export function publisherFromEnv(): { env: PublisherEnv } | { env: null; reason: string } {
  const privateKey = process.env.PUBLISHER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) return { env: null, reason: "PUBLISHER_PRIVATE_KEY is not set" };
  let feed = process.env.NUNO_FEED_ADDRESS as Address | undefined;
  if (!feed && existsSync(DEPLOYMENTS)) feed = (JSON.parse(readFileSync(DEPLOYMENTS, "utf8")) as { NunoFeed: Address }).NunoFeed;
  if (!feed) return { env: null, reason: "no NUNO_FEED_ADDRESS and no deployments/monad-testnet.json (run pnpm deploy:contracts)" };
  return { env: { rpcUrl: config.testnetRpcUrl, chainId: config.publishChainId, feed, privateKey } };
}
