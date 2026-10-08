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
  // Sliding window: every pair funded within the window is linked (not fixed buckets, which
  // would miss two fundings 1 h apart that straddle a bucket boundary). Each wallet links to at
  // most MAX_PAIRWISE_GROUP following wallets, keeping work O(n) for huge fan-outs; consecutive
  // pairs are always included, so connectivity is unaffected.
  const out: Link[] = [];
  for (const [funder, edges] of byFunder) {
    const firstPerWallet = [...new Map([...edges].sort((x, y) => x.blockTime - y.blockTime).map((e) => [e.wallet, e])).values()];
    firstPerWallet.sort((x, y) => x.blockTime - y.blockTime);
    for (let i = 0; i < firstPerWallet.length; i++) {
      const a = firstPerWallet[i]!;
      for (let j = i + 1; j < firstPerWallet.length && j <= i + MAX_PAIRWISE_GROUP; j++) {
        const b = firstPerWallet[j]!;
        if (b.blockTime - a.blockTime > cfg.sameFunderWindowSecs) break;
        out.push({
          a: a.wallet,
          b: b.wallet,
          type: "same_direct_funder",
          weight: cfg.weights.same_direct_funder,
          evidence: [
            { type: "same_direct_funder", txHash: a.txHash, block: a.block, detail: funder },
            { type: "same_direct_funder", txHash: b.txHash, block: b.block, detail: funder },
          ],
        });
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
  // Shared ancestors on one lineage (e.g. hop 2 and hop 3 of the same chain) are one signal:
  // emit at most one link per pair, carrying the evidence of every shared source.
  const byPair = new Map<string, Link>();
  for (const group of bySource.values()) {
    for (const l of linkGroup(group, "common_funding_source", cfg.weights.common_funding_source)) {
      const k = l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`;
      const prev = byPair.get(k);
      if (prev) prev.evidence.push(...l.evidence);
      else byPair.set(k, l);
    }
  }
  return [...byPair.values()];
}

/** Wallets with a token's creator among their funding ancestors are linked to that creator. */
export function creatorFundedLinks(
  input: ClusterInput,
  cfg: ClusterConfig,
  ancestors: Map<Addr, Map<Addr, FundingEdge>>,
): Link[] {
  const ok = eligible(input);
  const out: Link[] = [];
  const creators = new Map<Addr, Addr[]>();
  for (const l of input.launches) creators.set(l.creator, [...(creators.get(l.creator) ?? []), l.token]);
  for (const [w, anc] of ancestors) {
    if (!ok(w)) continue;
    for (const [creator, tokens] of creators) {
      if (w === creator) continue;
      const e = anc.get(creator);
      if (!e) continue;
      out.push({
        a: creator,
        b: w,
        type: "creator_funded",
        weight: cfg.weights.creator_funded,
        evidence: [{ type: "creator_funded", txHash: e.txHash, block: e.block, token: tokens[0], detail: creator }],
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
      evidence: [{ type: "token_transfer" as const, txHash: t.txHash, block: t.block, token: t.token }],
    }));
}

function sameBlockLinks(
  input: ClusterInput,
  side: "buy" | "sell",
  type: "same_block_early_buy" | "same_block_sell",
  weight: number,
  keep: (token: Addr, block: number) => boolean,
): Link[] {
  const ok = eligible(input);
  const groups = new Map<string, Array<{ wallet: Addr; ev: Evidence }>>();
  for (const t of input.trades) {
    if (t.side !== side || !ok(t.wallet) || !keep(t.token, t.block)) continue;
    const k = `${t.token}:${t.block}`;
    const list = groups.get(k) ?? [];
    list.push({ wallet: t.wallet, ev: { type, txHash: t.txHash, block: t.block, token: t.token } });
    groups.set(k, list);
  }
  const out: Link[] = [];
  for (const group of groups.values()) out.push(...linkGroup(group, type, weight));
  return out;
}

export function earlyBuyLinks(input: ClusterInput, cfg: ClusterConfig): Link[] {
  const created = new Map(input.launches.map((l) => [l.token, l.createBlock]));
  return sameBlockLinks(input, "buy", "same_block_early_buy", cfg.weights.same_block_early_buy, (token, b) => {
    const c = created.get(token);
    return c !== undefined && b <= c + cfg.earlyBuyBlocks;
  });
}

export function sameBlockSellLinks(input: ClusterInput, cfg: ClusterConfig): Link[] {
  return sameBlockLinks(input, "sell", "same_block_sell", cfg.weights.same_block_sell, () => true);
}
