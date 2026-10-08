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

/**
 * Global weighted union-find over all edge types and all tokens. Link weights between the same pair accumulate;
 * the pair is unioned once its total reaches the threshold. Pure: same input, same output.
 */
export function clusterWallets(input: ClusterInput, cfg: ClusterConfig = DEFAULT_CLUSTER_CONFIG): ClusterResult {
  const ancestors = fundingAncestors(input, cfg.maxFundingHops);
  const links: Link[] = [
    ...sameDirectFunderLinks(input, cfg),
    ...commonSourceLinks(input, cfg, ancestors),
    ...creatorFundedLinks(input, cfg, ancestors),
    ...tokenTransferLinks(input, cfg),
    ...earlyBuyLinks(input, cfg),
    ...sameBlockSellLinks(input, cfg),
  ];

  const pairs = new Map<string, { weight: number; links: Link[] }>();
  for (const l of links) {
    if (l.a === l.b) continue;
    const k = pairKey(l.a, l.b);
    const p = pairs.get(k) ?? { weight: 0, links: [] };
    p.weight += l.weight;
    p.links.push(l);
    pairs.set(k, p);
  }

  const uf = new UnionFind();
  const members = new Set(input.wallets.filter((w) => !input.contracts.has(w)));
  for (const l of input.launches) members.add(l.creator);
  for (const w of members) uf.add(w);

  const accepted: Link[] = [];
  // Small epsilon so 0.5 + 0.5 reliably meets 1.0.
  for (const p of pairs.values()) {
    if (p.weight + 1e-9 >= cfg.unionThreshold) {
      for (const l of p.links) {
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
