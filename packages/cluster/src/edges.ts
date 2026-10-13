import type { Addr, ClusterConfig, ClusterInput, Evidence, FundingEdge, Link } from "./types.js";

// Groups up to this size are linked pairwise. Larger groups (bundles beyond ~256 wallets) are
// linked as a chain sorted by address, keeping work O(n). Sorting makes the same wallets form the
// same neighbour pairs in every group, so sub-threshold signals (0.5 same-block, 0.8 common
// source) still accumulate per pair across tokens for neighbours; non-neighbour pairs of very large
// groups only connect through those neighbours (documented in METHODOLOGY).
const MAX_PAIRWISE_GROUP = 256;

function linkGroup(
  members: Array<{ wallet: Addr; ev: Evidence }>,
  type: Link["type"],
  weight: number,
): Link[] {
  const out: Link[] = [];
  const uniq = [...new Map(members.map((m) => [m.wallet, m])).values()].sort((x, y) => x.wallet.localeCompare(y.wallet));
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

/** Each wallet's earliest payment from one funder (a Map built from sorted pairs would keep the latest). */
function firstPaymentPerWallet(edges: FundingEdge[]): FundingEdge[] {
  const first = new Map<Addr, FundingEdge>();
  for (const e of [...edges].sort((x, y) => x.blockTime - y.blockTime || x.txHash.localeCompare(y.txHash))) if (!first.has(e.wallet)) first.set(e.wallet, e);
  return [...first.values()];
}

/** Each wallet's earliest funding tx (any funder), for the farm exception's "fresh wallet" test. */
function firstFundingTx(input: ClusterInput): Map<Addr, string> {
  const firstFunding = new Map<Addr, string>();
  const earliest = new Map<Addr, number>();
  for (const f of input.funding)
    if (!earliest.has(f.wallet) || f.blockTime < earliest.get(f.wallet)!) {
      earliest.set(f.wallet, f.blockTime);
      firstFunding.set(f.wallet, f.txHash);
    }
  return firstFunding;
}

/** True when `n` distinct participants exceeds the distribution-hub cap (0 = no cap). */
const isHub = (n: number, cfg: ClusterConfig) => cfg.maxHubFanout > 0 && n > cfg.maxHubFanout;

/**
 * Farm pattern: tiny, similar payments, mostly each recipient's first funding. Such a funder still links its
 * wallets above the hub cap. `firstFunding` maps a wallet to the tx hash of its earliest funding edge.
 */
export function looksLikeFarm(payments: FundingEdge[], firstFunding: Map<Addr, string>, cfg: ClusterConfig): boolean {
  const values = payments.map((p) => p.value).filter((v): v is bigint => v !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (values.length < payments.length || values.length === 0) return false; // amounts unknown: no exception
  const median = values[Math.floor(values.length / 2)]!;
  if (median > cfg.farmMaxMedianWei) return false;
  const similar = values.filter((v) => v * 2n >= median && v <= median * 2n).length;
  const fresh = payments.filter((p) => firstFunding.get(p.wallet) === p.txHash).length;
  return similar >= cfg.farmShare * values.length && fresh >= cfg.farmShare * payments.length;
}

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
  const firstFunding = firstFundingTx(input);
  // Chain, not all pairs: wallets are sorted by funding time and each is linked to the next one funded within
  // the window. A same-funder link alone meets the union threshold, so the chain gives exactly the same
  // groups as linking every pair within the window (any two such wallets are joined through the ones funded
  // between them), with O(n) evidence instead of O(n²). A 298-wallet farm produced 82,176 pair links.
  const out: Link[] = [];
  for (const [funder, edges] of byFunder) {
    const firstPerWallet = firstPaymentPerWallet(edges);
    // Distribution hub: funds too many participants to mean "same owner", unless it pays out like a farm.
    const funded = Math.max(firstPerWallet.length, input.fanout?.funded.get(funder) ?? 0);
    if (isHub(funded, cfg) && !looksLikeFarm(firstPerWallet, firstFunding, cfg)) continue;
    firstPerWallet.sort((x, y) => x.blockTime - y.blockTime || x.wallet.localeCompare(y.wallet));
    for (let i = 1; i < firstPerWallet.length; i++) {
      const a = firstPerWallet[i - 1]!;
      const b = firstPerWallet[i]!;
      if (b.blockTime - a.blockTime > cfg.sameFunderWindowSecs) continue;
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
    if (isHub(new Set(group.map((g) => g.wallet)).size, cfg)) continue; // ancestor shared by too many participants
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
  // A creator that is a funding ancestor of too many participants is a hub too, unless its own direct
  // payouts look like a farm (an operator seeding its own buyer wallets is exactly what this edge is for).
  const descendants = new Map<Addr, number>();
  for (const [w, anc] of ancestors) if (ok(w)) for (const a of anc.keys()) if (creators.has(a)) descendants.set(a, (descendants.get(a) ?? 0) + 1);
  const firstFunding = firstFundingTx(input);
  const farmCreators = new Set<Addr>();
  for (const [c, n] of descendants) descendants.set(c, Math.max(n, input.fanout?.funded.get(c) ?? 0));
  for (const creator of creators.keys()) {
    if (!isHub(descendants.get(creator) ?? 0, cfg)) continue;
    const paid = firstPaymentPerWallet(input.funding.filter((f) => f.origin === creator && ok(f.wallet)));
    if (paid.length && looksLikeFarm(paid, firstFunding, cfg)) farmCreators.add(creator);
  }
  for (const [w, anc] of ancestors) {
    if (!ok(w)) continue;
    for (const [creator, tokens] of creators) {
      if (w === creator || (isHub(descendants.get(creator) ?? 0, cfg) && !farmCreators.has(creator))) continue;
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
  const direct = input.transfers.filter((t) => t.from !== t.to && ok(t.from) && ok(t.to));
  // Wallets that SEND tokens to too many distinct participants (airdrops, payout or bot wallets) are hubs.
  // Receiving from many is not: farm wallets consolidating into one main wallet is strong evidence.
  const recipients = new Map<Addr, Set<Addr>>();
  for (const t of direct) {
    const s = recipients.get(t.from) ?? new Set<Addr>();
    s.add(t.to);
    recipients.set(t.from, s);
  }
  const hub = (w: Addr) => isHub(Math.max(recipients.get(w)?.size ?? 0, input.fanout?.sent.get(w) ?? 0), cfg);
  return direct
    .filter((t) => !hub(t.from) && !hub(t.to))
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
