import type { Addr, ClusterConfig, ClusterInput, Evidence, FundingEdge, Link } from "./types.js";

// Large groups are linked as a time-ordered chain rather than all pairs, keeping work O(n);
// connectivity is identical, only per-pair weight accumulation across edge types is reduced.
const MAX_PAIRWISE_GROUP = 64;

function linkGroup(
  members: Array<{ wallet: Addr; ev: Evidence }>,
  type: Link["type"],
  weight: number,
): Link[] {
  const out: Link[] = [];
  const uniq = [...new Map(members.map((m) => [m.wallet, m])).values()];
  if (uniq.length < 2) return out;
  if (uniq.length <= MAX_PAIRWISE_GROUP) {
    for (let i = 0; i < uniq.length; i++)
      for (let j = i + 1; j < uniq.length; j++)
        out.push({ a: uniq[i]!.wallet, b: uniq[j]!.wallet, type, weight, evidence: [uniq[i]!.ev, uniq[j]!.ev] });
  } else {
    for (let i = 1; i < uniq.length; i++)
      out.push({ a: uniq[i - 1]!.wallet, b: uniq[i]!.wallet, type, weight, evidence: [uniq[i - 1]!.ev, uniq[i]!.ev] });
  }
  return out;
}

const eligible = (input: ClusterInput) => {
  const set = new Set(input.wallets);
  return (w: Addr) => set.has(w) && !input.contracts.has(w);
};

/** Wallets whose direct (hop-1) funding came from the same non-infrastructure origin within the window. */
export function sameDirectFunderLinks(input: ClusterInput, cfg: ClusterConfig): Link[] {
  const ok = eligible(input);
  const byFunder = new Map<Addr, FundingEdge[]>();
  for (const f of input.funding) {
    if (!ok(f.wallet) || input.infrastructure.has(f.origin) || f.origin === f.wallet) continue;
    const list = byFunder.get(f.origin) ?? [];
    list.push(f);
    byFunder.set(f.origin, list);
  }
  const out: Link[] = [];
  for (const [funder, edges] of byFunder) {
    edges.sort((x, y) => x.blockTime - y.blockTime);
    // Split into windows: consecutive fundings no more than the window apart from the window start.
    let start = 0;
    for (let i = 1; i <= edges.length; i++) {
      if (i === edges.length || edges[i]!.blockTime - edges[start]!.blockTime > cfg.sameFunderWindowSecs) {
        const group = edges.slice(start, i).map((e) => ({
          wallet: e.wallet,
          ev: { type: "same_direct_funder" as const, txHash: e.txHash, block: e.block, detail: funder },
        }));
        out.push(...linkGroup(group, "same_direct_funder", cfg.weights.same_direct_funder));
        start = i;
      }
    }
  }
  return out;
}

/** Ancestors (origins) of each wallet up to maxHops, skipping infrastructure, with the hop-1 edge as evidence. */
export function fundingAncestors(input: ClusterInput, maxHops: number): Map<Addr, Map<Addr, FundingEdge>> {
  const parents = new Map<Addr, FundingEdge[]>();
  for (const f of input.funding) {
    const list = parents.get(f.wallet) ?? [];
    list.push(f);
    parents.set(f.wallet, list);
  }
  const out = new Map<Addr, Map<Addr, FundingEdge>>();
  for (const w of input.wallets) {
    const anc = new Map<Addr, FundingEdge>();
    let frontier: Array<{ addr: Addr; via: FundingEdge | null }> = [{ addr: w, via: null }];
    for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
      const next: typeof frontier = [];
      for (const { addr, via } of frontier) {
        for (const e of parents.get(addr) ?? []) {
          if (e.origin === addr || input.infrastructure.has(e.origin) || anc.has(e.origin) || e.origin === w) continue;
          const evidenceEdge = via ?? e;
          anc.set(e.origin, evidenceEdge);
          next.push({ addr: e.origin, via: evidenceEdge });
        }
      }
      frontier = next;
    }
    out.set(w, anc);
  }
  return out;
}

/** Wallets sharing any non-infrastructure ancestor within maxHops. */
export function commonSourceLinks(
  input: ClusterInput,
  cfg: ClusterConfig,
  ancestors: Map<Addr, Map<Addr, FundingEdge>>,
): Link[] {
  const ok = eligible(input);
  const bySource = new Map<Addr, Array<{ wallet: Addr; ev: Evidence }>>();
  for (const [w, anc] of ancestors) {
    if (!ok(w)) continue;
    for (const [src, e] of anc) {
      const list = bySource.get(src) ?? [];
      list.push({ wallet: w, ev: { type: "common_funding_source", txHash: e.txHash, block: e.block, detail: src } });
      bySource.set(src, list);
    }
  }
  const out: Link[] = [];
  for (const group of bySource.values()) out.push(...linkGroup(group, "common_funding_source", cfg.weights.common_funding_source));
  return out;
}

/** Wallets with the token creator among their funding ancestors are linked to the creator. */
export function creatorFundedLinks(
  input: ClusterInput,
  cfg: ClusterConfig,
  ancestors: Map<Addr, Map<Addr, FundingEdge>>,
): Link[] {
  const ok = eligible(input);
  const out: Link[] = [];
  for (const [w, anc] of ancestors) {
    if (!ok(w) || w === input.creator) continue;
    const e = anc.get(input.creator);
    if (e) {
      out.push({
        a: input.creator,
        b: w,
        type: "creator_funded",
        weight: cfg.weights.creator_funded,
        evidence: [{ type: "creator_funded", txHash: e.txHash, block: e.block, detail: input.creator }],
      });
    }
  }
  return out;
}

/** Direct token transfers between two eligible (non-contract) wallets. */
export function tokenTransferLinks(input: ClusterInput, cfg: ClusterConfig): Link[] {
  const ok = eligible(input);
  return input.transfers
    .filter((t) => t.from !== t.to && ok(t.from) && ok(t.to))
    .map((t) => ({
      a: t.from,
      b: t.to,
      type: "token_transfer" as const,
      weight: cfg.weights.token_transfer,
      evidence: [{ type: "token_transfer" as const, txHash: t.txHash, block: t.block }],
    }));
}

function sameBlockLinks(
  input: ClusterInput,
  side: "buy" | "sell",
  type: "same_block_early_buy" | "same_block_sell",
  weight: number,
  blockFilter: (b: number) => boolean,
): Link[] {
  const ok = eligible(input);
  const byBlock = new Map<number, Array<{ wallet: Addr; ev: Evidence }>>();
  for (const t of input.trades) {
    if (t.side !== side || !ok(t.wallet) || !blockFilter(t.block)) continue;
    const list = byBlock.get(t.block) ?? [];
    list.push({ wallet: t.wallet, ev: { type, txHash: t.txHash, block: t.block } });
    byBlock.set(t.block, list);
  }
  const out: Link[] = [];
  for (const group of byBlock.values()) out.push(...linkGroup(group, type, weight));
  return out;
}

export function earlyBuyLinks(input: ClusterInput, cfg: ClusterConfig): Link[] {
  const end = input.createBlock + cfg.earlyBuyBlocks;
  return sameBlockLinks(input, "buy", "same_block_early_buy", cfg.weights.same_block_early_buy, (b) => b <= end);
}

export function sameBlockSellLinks(input: ClusterInput, cfg: ClusterConfig): Link[] {
  return sameBlockLinks(input, "sell", "same_block_sell", cfg.weights.same_block_sell, () => true);
}
