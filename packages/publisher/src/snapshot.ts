import type { Hex } from "viem";

/** Mirrors NunoFeed.Snapshot. */
export interface FeedSnapshot {
  sourceBlock: bigint;
  publishedAt: bigint;
  rawHolders: number;
  realHolders: number;
  clusterSupplyBps: number;
  effectiveTop10Bps: number;
  creatorLinkedSupplyBps: number;
  organicVolumeBps: number;
  evidenceRoot: Hex;
}

export interface MetricsRow {
  token: string;
  sourceBlock: number;
  rawHolders: number;
  realHolders: number;
  effectiveTop10Bps: number;
  clusterSupplyBps: number;
  creatorLinkedSupplyBps: number;
  organicVolumeBps: number;
  evidenceRoot: string;
}

const MAX_U32 = 2 ** 32 - 1;

const bps = (name: string, v: number) => {
  if (!Number.isInteger(v) || v < 0 || v > 10_000) throw new Error(`${name} out of range: ${v}`);
  return v;
};

/** Convert a stored metrics row to the on-chain struct, validating every bound NunoFeed enforces. */
export function toSnapshot(row: MetricsRow): FeedSnapshot {
  if (!/^0x[0-9a-f]{64}$/i.test(row.evidenceRoot)) throw new Error(`bad evidenceRoot ${row.evidenceRoot}`);
  if (row.rawHolders < 0 || row.rawHolders > MAX_U32) throw new Error(`rawHolders out of range: ${row.rawHolders}`);
  if (row.realHolders < 0 || row.realHolders > row.rawHolders) {
    throw new Error(`realHolders ${row.realHolders} must be within [0, rawHolders ${row.rawHolders}]`);
  }
  return {
    sourceBlock: BigInt(row.sourceBlock),
    publishedAt: 0n, // stamped by the contract
    rawHolders: row.rawHolders,
    realHolders: row.realHolders,
    clusterSupplyBps: bps("clusterSupplyBps", row.clusterSupplyBps),
    effectiveTop10Bps: bps("effectiveTop10Bps", row.effectiveTop10Bps),
    creatorLinkedSupplyBps: bps("creatorLinkedSupplyBps", row.creatorLinkedSupplyBps),
    organicVolumeBps: bps("organicVolumeBps", row.organicVolumeBps),
    evidenceRoot: row.evidenceRoot as Hex,
  };
}

export interface PublishPolicy {
  /** Republish when any bps metric moved at least this much. */
  minBpsDelta: number;
  /** Republish unchanged data after this many seconds so consumers' freshness checks keep passing. */
  heartbeatSecs: number;
}

export const DEFAULT_PUBLISH_POLICY: PublishPolicy = { minBpsDelta: 25, heartbeatSecs: 6 * 3600 };

export type PublishDecision = { publish: true; reason: string } | { publish: false; reason: string };

/** Decide whether `next` is a meaningful change over the on-chain `prev` (publishedAt 0 = none). */
export function shouldPublish(prev: FeedSnapshot, next: FeedSnapshot, nowSecs: number, policy = DEFAULT_PUBLISH_POLICY): PublishDecision {
  if (prev.publishedAt === 0n) return { publish: true, reason: "first snapshot" };
  if (next.sourceBlock < prev.sourceBlock) return { publish: false, reason: "older than on-chain snapshot" };
  if (next.rawHolders !== prev.rawHolders || next.realHolders !== prev.realHolders) {
    return { publish: true, reason: "holder counts changed" };
  }
  const deltas: Array<[string, number]> = [
    ["clusterSupplyBps", next.clusterSupplyBps - prev.clusterSupplyBps],
    ["effectiveTop10Bps", next.effectiveTop10Bps - prev.effectiveTop10Bps],
    ["creatorLinkedSupplyBps", next.creatorLinkedSupplyBps - prev.creatorLinkedSupplyBps],
    ["organicVolumeBps", next.organicVolumeBps - prev.organicVolumeBps],
  ];
  const moved = deltas.find(([, d]) => Math.abs(d) >= policy.minBpsDelta);
  if (moved) return { publish: true, reason: `${moved[0]} moved ${moved[1]} bps` };
  if (next.evidenceRoot.toLowerCase() !== prev.evidenceRoot.toLowerCase()) return { publish: true, reason: "evidence changed" };
  if (nowSecs - Number(prev.publishedAt) >= policy.heartbeatSecs) return { publish: true, reason: "heartbeat" };
  return { publish: false, reason: "no meaningful change" };
}
