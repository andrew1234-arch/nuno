import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import { INDEXER_CURSOR, backfillTxSigners, getCursor, indexBlocks } from "@nuno/indexer";
import { pendingBuyers, resolveFundingTree } from "@nuno/funding";
import { MANUAL_INFRASTRUCTURE, runAll, storeRun } from "@nuno/metrics";
import { publishAll } from "@nuno/publisher";
import { RpcClient, config, createDb, getBlockNumber, sleep } from "@nuno/shared";
import { nextSteps } from "./schedule.js";

// One long-running process for live operation:
// tail index -> tx signers -> funding for new buyers -> metrics (debounced) -> publish.
const SAFE_LAG = 10;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 3_000);
const cfg = {
  minIntervalMs: Number(process.env.METRICS_MIN_INTERVAL_MS ?? 60_000),
  heartbeatMs: Number(process.env.PUBLISH_HEARTBEAT_MS ?? 30 * 60_000),
};

function publisherConfig(): { feed: Address; privateKey: Hex } | null {
  const privateKey = process.env.PUBLISHER_PRIVATE_KEY as Hex | undefined;
  if (!privateKey) return null;
  if (process.env.NUNO_FEED_ADDRESS) return { feed: process.env.NUNO_FEED_ADDRESS as Address, privateKey };
  const file = resolve(import.meta.dirname, "../../../deployments/monad-testnet.json");
  if (!existsSync(file)) return null;
  return { feed: (JSON.parse(readFileSync(file, "utf8")) as { NunoFeed: Address }).NunoFeed, privateKey };
}

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

async function main() {
  const { db } = createDb();
  const logsRpc = new RpcClient({ url: config.mainnetLogsRpcUrls, maxConcurrency: 4 });
  const archiveRpc = new RpcClient({ url: config.mainnetRpcUrl, maxConcurrency: 6, timeoutMs: 60_000 });
  const indexCtx = { db, logsRpc, logsRange: config.logsRange, log };
  const pub = publisherConfig();
  log(`[worker] starting; publishing ${pub ? `to ${pub.feed}` : "disabled (no PUBLISHER_PRIVATE_KEY / feed address)"}`);

  const cursor = await getCursor(db, INDEXER_CURSOR);
  if (cursor === null) throw new Error("no indexer cursor: run pnpm index:backfill first");
  let next = cursor + 1;
  // Start dirty so the first loop recomputes from whatever the backfill left.
  const state = { dirty: true, lastMetricsAt: 0, lastPublishAt: 0 };

  for (;;) {
    try {
      const tip = (await getBlockNumber(logsRpc)) - SAFE_LAG;
      if (tip >= next) {
        const s = await indexBlocks(indexCtx, next, tip);
        next = tip + 1;
        if (s.trades || s.creates || s.transfers || s.swaps) {
          state.dirty = true;
          await backfillTxSigners(indexCtx);
          for (const b of await pendingBuyers(db, 50)) {
            await resolveFundingTree({ db, rpc: archiveRpc, log }, b.trader, b.firstBuy - 1, 3);
          }
        }
      }

      const now = Date.now();
      const steps = nextSteps(state, now, cfg);
      if (steps.metrics) {
        const run = await runAll({ db, rpc: archiveRpc, infrastructure: new Set(MANUAL_INFRASTRUCTURE) }, next - 1);
        await storeRun(db, run);
        state.dirty = false;
        state.lastMetricsAt = now;
        log(`[worker] metrics: ${run.tokens.length} tokens, ${run.result.clusters.length} entities at block ${run.sourceBlock}`);
      }
      if (steps.publish && pub) {
        const results = await publishAll({ db, rpcUrl: config.testnetRpcUrl, chainId: 10143, ...pub, log });
        log(`[worker] published ${results.filter((r) => r.txHash).length} snapshots`);
      }
      if (steps.publish) state.lastPublishAt = now;
    } catch (err) {
      // Keep the loop alive through RPC hiccups; the cursor only advances after a range succeeds.
      log(`[worker] error: ${(err as Error).message}`);
      await sleep(10_000);
    }
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
