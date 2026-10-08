import { keccak256, stringToHex, type Hex } from "viem";
import type { Addr, Cluster } from "@nuno/cluster";

export const BPS = 10_000;

export interface Transfer {
  from: Addr;
  to: Addr;
  value: bigint;
}

export interface VolumeTrade {
  wallet: Addr;
  side: "buy" | "sell";
  block: number;
  /** MON leg of the trade (buy: MON in, sell: MON out). */
  mon: bigint;
  /** Token leg of the trade (buy: tokens out, sell: tokens in). */
  tokens: bigint;
}

export interface MetricsConfig {
  /** Same-entity buy+sell inside one bucket of this many blocks counts as round-trip wash. */
  washWindowBlocks: number;
  /** Entities whose |net token change| / gross tokens traded is below this are wash in full. */
  minNetPositionRatio: number;
}

export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  // ~18 minutes at 0.302 s/block.
  washWindowBlocks: 3600,
  minNetPositionRatio: 0.05,
};

export interface MetricsInput {
  token: Addr;
  creator: Addr;
  sourceBlock: number;
  /** All Transfer events of the token since creation (mints from 0x0 included). */
  transfers: Transfer[];
  /** Curve/pool contracts and other addresses never counted as holders (lowercase). */
  excludedHolders: Set<Addr>;
  /** wallet -> entity id (from the cluster engine). Missing wallets are their own entity. */
  entityOf: Map<Addr, string>;
  clusters: Cluster[];
  trades: VolumeTrade[];
}

export interface TokenMetrics {
  token: Addr;
  sourceBlock: number;
  totalSupply: bigint;
  rawHolders: number;
  realHolders: number;
  effectiveTop10Bps: number;
  clusterSupplyBps: number;
  creatorLinkedSupplyBps: number;
  rawVolume: bigint;
  organicVolume: bigint;
  organicVolumeBps: number;
  evidenceRoot: Hex;
}

export const ZERO: Addr = "0x0000000000000000000000000000000000000000";

/** Current balances from a token's full transfer history. Mints come from 0x0; burns go to 0x0. */
export function balancesFromTransfers(transfers: Transfer[]): Map<Addr, bigint> {
  const bal = new Map<Addr, bigint>();
  for (const t of transfers) {
    if (t.from !== ZERO) bal.set(t.from, (bal.get(t.from) ?? 0n) - t.value);
    if (t.to !== ZERO) bal.set(t.to, (bal.get(t.to) ?? 0n) + t.value);
  }
  return bal;
}

export function totalSupplyFromTransfers(transfers: Transfer[]): bigint {
  let s = 0n;
  for (const t of transfers) {
    if (t.from === ZERO) s += t.value;
    if (t.to === ZERO) s -= t.value;
  }
  return s;
}

/** floor(part / whole * 10000), clamped to [0, 10000]; 0 when whole is 0. */
export function toBps(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  const v = Number((part * BigInt(BPS)) / whole);
  return Math.max(0, Math.min(BPS, v));
}

const entity = (entityOf: Map<Addr, string>, w: Addr) => entityOf.get(w) ?? w;

/**
 * MON volume classified as wash-like:
 *  (a) entities whose net token position change over the whole period is < minNetPositionRatio
 *      of their gross tokens traded: all their volume;
 *  (b) otherwise, round trips: per entity per window bucket, 2 × min(buy MON, sell MON).
 */
export function washVolume(trades: VolumeTrade[], entityOf: Map<Addr, string>, cfg: MetricsConfig): bigint {
  type Acc = { tokIn: bigint; tokOut: bigint; mon: bigint; buckets: Map<number, { b: bigint; s: bigint }> };
  const per = new Map<string, Acc>();
  for (const t of trades) {
    const e = entity(entityOf, t.wallet);
    const acc = per.get(e) ?? { tokIn: 0n, tokOut: 0n, mon: 0n, buckets: new Map() };
    if (t.side === "buy") acc.tokIn += t.tokens;
    else acc.tokOut += t.tokens;
    acc.mon += t.mon;
    const k = Math.floor(t.block / cfg.washWindowBlocks);
    const bk = acc.buckets.get(k) ?? { b: 0n, s: 0n };
    if (t.side === "buy") bk.b += t.mon;
    else bk.s += t.mon;
    acc.buckets.set(k, bk);
    per.set(e, acc);
  }

  // Ratio compared in integer math: net * 1e6 < gross * ratio * 1e6.
  const ratioPpm = BigInt(Math.round(cfg.minNetPositionRatio * 1_000_000));
  let wash = 0n;
  for (const acc of per.values()) {
    const gross = acc.tokIn + acc.tokOut;
    const net = acc.tokIn > acc.tokOut ? acc.tokIn - acc.tokOut : acc.tokOut - acc.tokIn;
    // Entities that only bought or only sold are directional, never wash.
    const roundTripped = acc.tokIn > 0n && acc.tokOut > 0n;
    if (roundTripped && net * 1_000_000n < gross * ratioPpm) {
      wash += acc.mon;
      continue;
    }
    for (const { b, s } of acc.buckets.values()) wash += 2n * (b < s ? b : s);
  }
  return wash;
}

/**
 * Canonical JSON of the clusters and evidence behind a token's metrics, and its keccak256.
 * Deliberately excludes the source block: the root changes only when the evidence changes, so
 * publishers can use it to detect real changes (the block is published separately).
 */
export function evidenceRoot(token: Addr, clusters: Cluster[]): { root: Hex; canonical: string } {
  const canon = {
    token,
    clusters: [...clusters]
      .map((c) => ({
        id: c.id,
        members: [...c.members].sort(),
        evidence: c.links
          .flatMap((l) => l.evidence.map((e) => [l.a < l.b ? l.a : l.b, l.a < l.b ? l.b : l.a, e.type, e.txHash, e.block] as const))
          .map((x) => x.join(":"))
          .sort()
          .filter((x, i, arr) => i === 0 || arr[i - 1] !== x),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  const canonical = JSON.stringify(canon);
  return { root: keccak256(stringToHex(canonical)), canonical };
}

export function computeMetrics(input: MetricsInput, cfg: MetricsConfig = DEFAULT_METRICS_CONFIG): TokenMetrics {
  const totalSupply = totalSupplyFromTransfers(input.transfers);
  const balances = balancesFromTransfers(input.transfers);

  const holders = [...balances].filter(([a, v]) => v > 0n && a !== ZERO && !input.excludedHolders.has(a));
  const byEntity = new Map<string, bigint>();
  for (const [a, v] of holders) {
    const e = entity(input.entityOf, a);
    byEntity.set(e, (byEntity.get(e) ?? 0n) + v);
  }

  const top10 = [...byEntity.values()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, 10);
  const top10Sum = top10.reduce((s, v) => s + v, 0n);

  const clusterMembers = new Set(input.clusters.flatMap((c) => c.members));
  const clusterHeld = holders.filter(([a]) => clusterMembers.has(a)).reduce((s, [, v]) => s + v, 0n);

  const creatorEntity = entity(input.entityOf, input.creator);
  const creatorHeld = holders
    .filter(([a]) => entity(input.entityOf, a) === creatorEntity)
    .reduce((s, [, v]) => s + v, 0n);

  const rawVolume = input.trades.reduce((s, t) => s + t.mon, 0n);
  const wash = washVolume(input.trades, input.entityOf, cfg);
  const organicVolume = rawVolume > wash ? rawVolume - wash : 0n;

  return {
    token: input.token,
    sourceBlock: input.sourceBlock,
    totalSupply,
    rawHolders: holders.length,
    realHolders: byEntity.size,
    effectiveTop10Bps: toBps(top10Sum, totalSupply),
    clusterSupplyBps: toBps(clusterHeld, totalSupply),
    creatorLinkedSupplyBps: toBps(creatorHeld, totalSupply),
    rawVolume,
    organicVolume,
    organicVolumeBps: toBps(organicVolume, rawVolume),
    evidenceRoot: evidenceRoot(input.token, input.clusters).root,
  };
}
