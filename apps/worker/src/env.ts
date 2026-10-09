import type { Address, Hex } from "viem";

/** Worker bindings: D1 + vars from wrangler.jsonc + secrets. */
export interface Env {
  DB: D1Database;
  MONAD_MAINNET_RPC_URL: string;
  MONAD_MAINNET_LOGS_RPC_URLS: string;
  MONAD_MAINNET_LOGS_RANGE: string;
  MONAD_TESTNET_RPC_URL: string;
  PUBLISH_CHAIN_ID: string;
  NUNO_FEED_ADDRESS: string;
  BACKFILL_DAYS: string;
  MIN_BUYERS: string;
  STORAGE_TARGET_BYTES: string;
  STORAGE_ALARM_BYTES: string;
  STORAGE_HARD_STOP_BYTES: string;
  PUBLISHER_PRIVATE_KEY?: string;
}

function num(env: Env, key: keyof Env, fallback: number): number {
  const raw = env[key];
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`var ${String(key)} must be a positive number, got "${raw}"`);
  return n;
}

export function settings(env: Env) {
  const feed = env.NUNO_FEED_ADDRESS?.trim();
  const key = env.PUBLISHER_PRIVATE_KEY?.trim();
  return {
    archiveRpcUrl: env.MONAD_MAINNET_RPC_URL,
    logsRpcUrls: env.MONAD_MAINNET_LOGS_RPC_URLS.split(",").map((u) => u.trim()).filter(Boolean),
    logsRange: num(env, "MONAD_MAINNET_LOGS_RANGE", 100),
    backfillDays: num(env, "BACKFILL_DAYS", 7),
    minBuyers: num(env, "MIN_BUYERS", 20),
    budget: {
      targetBytes: num(env, "STORAGE_TARGET_BYTES", 1_500_000_000),
      alarmBytes: num(env, "STORAGE_ALARM_BYTES", 2_500_000_000),
      hardStopBytes: num(env, "STORAGE_HARD_STOP_BYTES", 3_000_000_000),
    },
    publisher:
      feed && key
        ? { rpcUrl: env.MONAD_TESTNET_RPC_URL, chainId: num(env, "PUBLISH_CHAIN_ID", 10143), feed: feed as Address, privateKey: key as Hex }
        : null,
  };
}

export type Settings = ReturnType<typeof settings>;
