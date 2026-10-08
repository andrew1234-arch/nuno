import { existsSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(): void {
  // Walk up from cwd so pnpm --filter scripts (cwd = package dir) find the root .env.
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const file = resolve(dir, ".env");
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
    dir = resolve(dir, "..");
  }
}

loadDotEnv();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

function num(name: string, fallback: number, opts: { positive?: boolean } = {}): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be a number, got "${v}"`);
  if (opts.positive && n <= 0) throw new Error(`Env var ${name} must be > 0, got ${n}`);
  return n;
}

export const config = {
  get mainnetRpcUrl(): string {
    return req("MONAD_MAINNET_RPC_URL");
  },
  /** Comma-separated list; eth_getLogs calls round-robin across them. */
  get mainnetLogsRpcUrls(): string[] {
    // MONAD_MAINNET_LOGS_RPC_URL (single URL) is the older name; still honoured.
    const raw =
      process.env.MONAD_MAINNET_LOGS_RPC_URLS || process.env.MONAD_MAINNET_LOGS_RPC_URL || req("MONAD_MAINNET_RPC_URL");
    return raw.split(",").map((u) => u.trim()).filter(Boolean);
  },
  /** Max inclusive block span per eth_getLogs call, measured per endpoint (see docs/PROGRESS.md). */
  get logsRange(): number {
    return num("MONAD_MAINNET_LOGS_RANGE", 100);
  },
  get testnetRpcUrl(): string {
    return req("MONAD_TESTNET_RPC_URL");
  },
  get databaseUrl(): string {
    return req("DATABASE_URL");
  },
  get backfillDays(): number {
    return num("BACKFILL_DAYS", 7);
  },
  /** Worker loop sleep between ticks. */
  get workerPollMs(): number {
    return num("WORKER_POLL_MS", 3_000, { positive: true });
  },
  /** Minimum gap between metrics recomputes (debounce). */
  get metricsMinIntervalMs(): number {
    return num("METRICS_MIN_INTERVAL_MS", 60_000, { positive: true });
  },
  /** Publisher heartbeat: run the publish policy at least this often. */
  get publishHeartbeatMs(): number {
    return num("PUBLISH_HEARTBEAT_MS", 30 * 60_000, { positive: true });
  },
  /** Delay before retrying after a failed publish. */
  get publishRetryMs(): number {
    return num("PUBLISH_RETRY_MS", 60_000, { positive: true });
  },
  /** Chain the feed lives on (10143 = Monad testnet; 31337 for a local anvil demo). */
  get publishChainId(): number {
    return num("PUBLISH_CHAIN_ID", 10143, { positive: true });
  },
  get nansenApiKey(): string | undefined {
    return process.env.NANSEN_API_KEY || undefined;
  },
};
