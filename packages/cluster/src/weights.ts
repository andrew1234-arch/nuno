import type { ClusterConfig, EdgeType, Evidence } from "./types.js";

/**
 * Total link weight between one pair of wallets, derived only from its evidence rows. This is the
 * single rule used by the in-memory engine, the local full run and the incremental cron update,
 * so all three agree and re-inserting evidence never changes a weight.
 *  - same_direct_funder, creator_funded: full weight if any evidence.
 *  - common_funding_source: weight once per pair, however many shared ancestors (one lineage).
 *  - token_transfer: weight per distinct transfer tx.
 *  - same_block_early_buy / same_block_sell: weight per distinct (token, block) co-occurrence.
 */
export function pairWeight(evidence: Array<Pick<Evidence, "type" | "txHash" | "block" | "token">>, cfg: ClusterConfig): number {
  const byType = new Map<EdgeType, Set<string>>();
  for (const e of evidence) {
    const key =
      e.type === "same_block_early_buy" || e.type === "same_block_sell"
        ? `${e.token ?? ""}:${e.block}`
        : e.type === "token_transfer"
          ? e.txHash
          : "any";
    const set = byType.get(e.type) ?? new Set<string>();
    set.add(key);
    byType.set(e.type, set);
  }
  let w = 0;
  for (const [type, keys] of byType) w += cfg.weights[type] * keys.size;
  return w;
}

/** Union threshold check with a small epsilon so 0.5 + 0.5 reliably meets 1.0. */
export const meetsThreshold = (weight: number, cfg: ClusterConfig) => weight + 1e-9 >= cfg.unionThreshold;
