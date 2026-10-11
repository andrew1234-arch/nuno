import type { Address, Hex } from "viem";
import { budgetFromEnv } from "@nuno/metrics";
import { config } from "@nuno/shared/node";
import type { TickSettings } from "./tick.js";

function num(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${v}"`);
  return n;
}

/** Like `num`, but 0 is allowed (0 disables the rule). */
function nonNegative(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${v}"`);
  return n;
}

/** Pipeline settings from env (GitHub Actions secrets/vars or a local .env). Secrets are never logged. */
export function settingsFromEnv(): TickSettings {
  const key = process.env.PUBLISHER_PRIVATE_KEY?.trim();
  const feed = process.env.NUNO_FEED_ADDRESS?.trim();
  return {
    logsRange: config.logsRange,
    backfillDays: config.backfillDays,
    // Rule 5 is off (0) while storage is far under target: nad.fun tokens have 2-8 buyers and the
    // low-buyer tokens are the operator's, so pruning them deletes the evidence (user decision 2026-10-11).
    minBuyers: nonNegative("MIN_BUYERS", 0),
    budget: budgetFromEnv(process.env),
    // ~10 min between runs ≈ 2,000 blocks; 4,000 lets a late run catch up.
    maxBlocksPerRun: num("TICK_MAX_BLOCKS", 4_000),
    maxFundingPerRun: num("TICK_MAX_FUNDING", 25),
    fundingConcurrency: num("FUNDING_CONCURRENCY", 6),
    fundingBudgetMs: num("TICK_FUNDING_SECONDS", 360) * 1000,
    maxPublishPerRun: num("TICK_MAX_PUBLISH", 20),
    publisher: key && feed ? { rpcUrl: config.testnetRpcUrl, chainId: config.publishChainId, feed: feed as Address, privateKey: key as Hex } : null,
    nansen: { apiKey: process.env.NANSEN_API_KEY?.trim() || undefined, reserve: num("NANSEN_RESERVE", 3), maxCalls: num("NANSEN_MAX_CALLS_PER_RUN", 5) },
    dbPath: config.localDbPath,
  };
}
