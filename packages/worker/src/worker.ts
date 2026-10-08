import { INDEXER_CURSOR, backfillTxSigners, getCursor, indexBlocks } from "@nuno/indexer";
import { pendingBuyers, resolveFundingTree } from "@nuno/funding";
import { infrastructureSet, runAll, storeRun } from "@nuno/metrics";
import { publishAll, publisherFromEnv } from "@nuno/publisher";
import { RpcClient, config, createDb, getBlockNumber, sleep, type Db } from "@nuno/shared";
import { nextSteps, type ScheduleState } from "./schedule.js";

// One long-running process for live operation:
// tail index -> tx signers -> funding for new buyers -> metrics (debounced) -> publish.
const SAFE_LAG = 10;

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

async function resumeFrom(db: Db): Promise<number> {
  const cursor = await getCursor(db, INDEXER_CURSOR);
  if (cursor === null) throw new Error("no indexer cursor: run pnpm index:backfill first");
  return cursor + 1;
}

async function main() {
  const schedule = {
    minIntervalMs: config.metricsMinIntervalMs,
    heartbeatMs: config.publishHeartbeatMs,
    retryMs: config.publishRetryMs,
  };
  const pollMs = config.workerPollMs;
  const { db } = createDb();
  const logsRpc = new RpcClient({ url: config.mainnetLogsRpcUrls, maxConcurrency: 4, cacheSize: 2_000 });
  // Small cache: only balance/nonce/code lookups are cached in the funding path.
  const archiveRpc = new RpcClient({ url: config.mainnetRpcUrl, maxConcurrency: 6, timeoutMs: 60_000, cacheSize: 5_000 });
  const indexCtx = { db, logsRpc, logsRange: config.logsRange, log };
  const pub = publisherFromEnv();
  log(`[worker] starting; publishing ${pub.env ? `to ${pub.env.feed} on chain ${pub.env.chainId}` : `disabled (${pub.reason})`}`);

  let next = await resumeFrom(db);
  // Start dirty so the first loop recomputes from whatever the backfill left.
  const state: ScheduleState = { dirty: true, lastMetricsAt: 0, lastPublishAttemptAt: 0, publishPending: false };

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
      const steps = nextSteps(state, now, schedule);
      if (steps.metrics) {
        const run = await runAll({ db, rpc: archiveRpc, infrastructure: infrastructureSet() }, next - 1);
        await storeRun(db, run);
        state.dirty = false;
        state.lastMetricsAt = now;
        state.publishPending = true;
        log(`[worker] metrics: ${run.tokens.length} tokens, ${run.result.clusters.length} entities at block ${run.sourceBlock}`);
      }
      if (steps.publish) {
        state.lastPublishAttemptAt = now;
        if (!pub.env) state.publishPending = false;
        else {
          const results = await publishAll({ db, ...pub.env, log });
          const failed = results.filter((r) => r.error).length;
          state.publishPending = failed > 0;
          log(`[worker] published ${results.filter((r) => r.txHash).length} snapshots, ${failed} failed`);
        }
      }
    } catch (err) {
      log(`[worker] error: ${(err as Error).message}`);
      // indexBlocks saves the cursor after every chunk: resume from what was actually stored,
      // not from the start of the failed range.
      try {
        next = await resumeFrom(db);
      } catch (e) {
        log(`[worker] could not re-read cursor: ${(e as Error).message}`);
      }
      await sleep(10_000);
    }
    await sleep(pollMs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
