import {
  commonSourceLinks,
  creatorFundedLinks,
  earlyBuyLinks,
  fundingAncestors,
  sameBlockSellLinks,
  sameDirectFunderLinks,
  tokenTransferLinks,
} from "./edges.js";
import { UnionFind } from "./unionfind.js";
import { meetsThreshold, pairWeight } from "./weights.js";
import {
  DEFAULT_CLUSTER_CONFIG,
  type Addr,
  type Cluster,
  type ClusterConfig,
  type ClusterInput,
  type ClusterResult,
  type Link,
} from "./types.js";

const pairKey = (a: Addr, b: Addr) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Every candidate link (accepted or not) produced by the six edge builders. */
export function buildLinks(input: ClusterInput, cfg: ClusterConfig = DEFAULT_CLUSTER_CONFIG): Link[] {
  const ancestors = fundingAncestors(input, cfg.maxFundingHops);
  return [
    ...sameDirectFunderLinks(input, cfg),
    ...commonSourceLinks(input, cfg, ancestors),
    ...creatorFundedLinks(input, cfg, ancestors),
    ...tokenTransferLinks(input, cfg),
    ...earlyBuyLinks(input, cfg),
    ...sameBlockSellLinks(input, cfg),
  ].filter((l) => l.a !== l.b);
}

/**
 * Global weighted union-find over all edge types and all tokens. A pair's weight is derived from
 * its evidence (see weights.ts) and the pair is unioned once it reaches the threshold.
 * Pure: same input, same output.
 */
export function clusterWallets(input: ClusterInput, cfg: ClusterConfig = DEFAULT_CLUSTER_CONFIG): ClusterResult {
  const links = buildLinks(input, cfg);
  const pairs = new Map<string, Link[]>();
  for (const l of links) {
    const k = pairKey(l.a, l.b);
    const list = pairs.get(k);
    if (list) list.push(l);
    else pairs.set(k, [l]);
  }

  const uf = new UnionFind();
  const members = new Set(input.wallets.filter((w) => !input.contracts.has(w)));
  for (const l of input.launches) members.add(l.creator);
  for (const w of members) uf.add(w);

  const accepted: Link[] = [];
  for (const pairLinks of pairs.values()) {
    if (meetsThreshold(pairWeight(pairLinks.flatMap((l) => l.evidence.map((e) => ({ ...e, type: l.type }))), cfg), cfg)) {
      for (const l of pairLinks) {
        uf.union(l.a, l.b);
        accepted.push(l);
      }
    }
  }

  const createdBy = new Map<Addr, Addr[]>();
  for (const l of input.launches) createdBy.set(l.creator, [...(createdBy.get(l.creator) ?? []), l.token]);

  const entityOf = new Map<Addr, string>();
  const clusters: Cluster[] = [];
  for (const group of uf.groups().values()) {
    const sorted = [...group].sort();
    const id = sorted[0]!;
    for (const w of sorted) entityOf.set(w, id);
    if (sorted.length < 2) continue;
    const set = new Set(sorted);
    clusters.push({
      id,
      members: sorted,
      createdTokens: sorted.flatMap((w) => createdBy.get(w) ?? []).sort(),
      links: accepted.filter((l) => set.has(l.a)),
    });
  }
  clusters.sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
  return { entityOf, clusters };
}

/**
 * Clusters relevant to one token: global clusters with at least one member among `participants`.
 * Membership stays global, so the same entity has the same id on every token.
 */
export function clustersForToken(result: ClusterResult, participants: Iterable<Addr>): Cluster[] {
  const ids = new Set<string>();
  for (const p of participants) {
    const id = result.entityOf.get(p);
    if (id !== undefined) ids.add(id);
  }
  return result.clusters.filter((c) => ids.has(c.id));
}
