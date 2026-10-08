import { describe, expect, it } from "vitest";
import type { Cluster } from "@nuno/cluster";
import {
  DEFAULT_METRICS_CONFIG,
  ZERO,
  balancesFromTransfers,
  computeMetrics,
  evidenceRoot,
  toBps,
  totalSupplyFromTransfers,
  washVolume,
  type MetricsInput,
  type VolumeTrade,
} from "./metrics.js";

// Hand-built test fixtures (not real chain data).
const CURVE = "0xcurve";
const CREATOR = "0xc0";
const E18 = 10n ** 18n;

const mint = (to: string, v: bigint) => ({ from: ZERO, to, value: v });
const xfer = (from: string, to: string, v: bigint) => ({ from, to, value: v });

function cluster(members: string[]): Cluster {
  const sorted = [...members].sort();
  return {
    id: sorted[0]!,
    members: sorted,
    containsCreator: sorted.includes(CREATOR),
    links: sorted.slice(1).map((m, i) => ({
      a: sorted[0]!,
      b: m,
      type: "same_direct_funder" as const,
      weight: 1,
      evidence: [{ type: "same_direct_funder" as const, txHash: `0xev${i}`, block: 10 + i }],
    })),
  };
}

function entityMap(clusters: Cluster[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of clusters) for (const w of c.members) m.set(w, c.id);
  return m;
}

function base(over: Partial<MetricsInput> = {}): MetricsInput {
  return {
    token: "0x70",
    creator: CREATOR,
    sourceBlock: 100,
    // Supply 1000: curve holds 600, a/b/c (one cluster) hold 100 each, d holds 50, creator 50.
    transfers: [
      mint(CURVE, 1000n),
      xfer(CURVE, "0xa", 100n),
      xfer(CURVE, "0xb", 100n),
      xfer(CURVE, "0xc", 100n),
      xfer(CURVE, "0xd", 50n),
      xfer(CURVE, CREATOR, 50n),
    ],
    excludedHolders: new Set([CURVE]),
    entityOf: new Map(),
    clusters: [],
    trades: [],
    ...over,
  };
}

describe("balances and supply", () => {
  it("nets transfers and ignores the zero address", () => {
    const t = [mint("0xa", 10n), xfer("0xa", "0xb", 4n), xfer("0xb", ZERO, 1n)];
    const b = balancesFromTransfers(t);
    expect(b.get("0xa")).toBe(6n);
    expect(b.get("0xb")).toBe(3n);
    expect(b.has(ZERO)).toBe(false);
    expect(totalSupplyFromTransfers(t)).toBe(9n);
  });
});

describe("toBps", () => {
  it("floors and clamps", () => {
    expect(toBps(1n, 3n)).toBe(3333);
    expect(toBps(5n, 5n)).toBe(10_000);
    expect(toBps(7n, 5n)).toBe(10_000);
    expect(toBps(1n, 0n)).toBe(0);
    expect(toBps(0n, 10n)).toBe(0);
  });
});

describe("holders", () => {
  it("rawHolders excludes curve/pool contracts and zero balances", () => {
    const m = computeMetrics(base({ transfers: [...base().transfers, xfer("0xd", "0xa", 50n)] }));
    // d now has 0.
    expect(m.rawHolders).toBe(4);
  });

  it("realHolders counts entities, not wallets", () => {
    const clusters = [cluster(["0xa", "0xb", "0xc"])];
    const m = computeMetrics(base({ clusters, entityOf: entityMap(clusters) }));
    expect(m.rawHolders).toBe(5);
    expect(m.realHolders).toBe(3);
  });
});

describe("supply concentration", () => {
  it("effectiveTop10Bps sums the top entities over total supply, excluding the curve", () => {
    const clusters = [cluster(["0xa", "0xb", "0xc"])];
    const m = computeMetrics(base({ clusters, entityOf: entityMap(clusters) }));
    // Entities: {a,b,c}=300, d=50, creator=50 -> 400 / 1000.
    expect(m.effectiveTop10Bps).toBe(4000);
  });

  it("effectiveTop10Bps keeps only 10 entities", () => {
    const holders = Array.from({ length: 12 }, (_, i) => `0xh${i}`);
    const m = computeMetrics(
      base({ transfers: [mint(CURVE, 1200n), ...holders.map((h) => xfer(CURVE, h, 100n))] }),
    );
    expect(m.effectiveTop10Bps).toBe(Math.floor((1000 * 10_000) / 1200));
  });

  it("clusterSupplyBps counts only multi-wallet cluster members", () => {
    const clusters = [cluster(["0xa", "0xb"])];
    const m = computeMetrics(base({ clusters, entityOf: entityMap(clusters) }));
    expect(m.clusterSupplyBps).toBe(2000);
  });

  it("creatorLinkedSupplyBps includes the creator's whole cluster", () => {
    const clusters = [cluster([CREATOR, "0xd"])];
    const m = computeMetrics(base({ clusters, entityOf: entityMap(clusters) }));
    expect(m.creatorLinkedSupplyBps).toBe(1000);
  });

  it("creatorLinkedSupplyBps is the creator's own balance when unclustered", () => {
    expect(computeMetrics(base()).creatorLinkedSupplyBps).toBe(500);
  });
});

describe("volume", () => {
  const t = (wallet: string, side: "buy" | "sell", block: number, mon: bigint, tokens: bigint): VolumeTrade => ({
    wallet,
    side,
    block,
    mon,
    tokens,
  });

  it("directional traders are fully organic", () => {
    const trades = [t("0xa", "buy", 1, 10n * E18, 100n), t("0xb", "buy", 2, 5n * E18, 50n), t("0xa", "sell", 50_000, 3n * E18, 20n)];
    expect(washVolume(trades, new Map(), DEFAULT_METRICS_CONFIG)).toBe(0n);
    const m = computeMetrics(base({ trades }));
    expect(m.rawVolume).toBe(18n * E18);
    expect(m.organicVolumeBps).toBe(10_000);
  });

  it("flags an entity whose net position change is < 5% of gross as wash in full", () => {
    // Buys 100 tokens, sells 98 across many hours: net 2 / gross 198 ≈ 1%.
    const trades = [t("0xa", "buy", 1, 10n * E18, 100n), t("0xa", "sell", 90_000, 9n * E18, 98n), t("0xb", "buy", 5, 1n * E18, 10n)];
    const m = computeMetrics(base({ trades }));
    expect(m.rawVolume).toBe(20n * E18);
    expect(m.organicVolume).toBe(1n * E18);
    expect(m.organicVolumeBps).toBe(500);
  });

  it("detects wash across wallets of the same entity", () => {
    const clusters = [cluster(["0xa", "0xb"])];
    // a buys, b sells the same tokens: entity net 0.
    const trades = [t("0xa", "buy", 1, 10n * E18, 100n), t("0xb", "sell", 2, 10n * E18, 100n)];
    expect(computeMetrics(base({ trades })).organicVolumeBps).toBe(10_000);
    expect(computeMetrics(base({ trades, clusters, entityOf: entityMap(clusters) })).organicVolumeBps).toBe(0);
  });

  it("counts same-window round trips of entities with a real net position", () => {
    // Buys 100 then sells 40 within one window: net 60 / gross 140, not full wash.
    // Round trip within the window: 2 * min(10, 4) = 8 MON wash.
    const trades = [t("0xa", "buy", 10, 10n * E18, 100n), t("0xa", "sell", 20, 4n * E18, 40n)];
    expect(washVolume(trades, new Map(), DEFAULT_METRICS_CONFIG)).toBe(8n * E18);
  });

  it("does not count buys and sells in different windows as round trips", () => {
    const w = DEFAULT_METRICS_CONFIG.washWindowBlocks;
    const trades = [t("0xa", "buy", 10, 10n * E18, 100n), t("0xa", "sell", 10 + 2 * w, 4n * E18, 40n)];
    expect(washVolume(trades, new Map(), DEFAULT_METRICS_CONFIG)).toBe(0n);
  });

  it("reports 0 organic bps when there is no volume", () => {
    const m = computeMetrics(base());
    expect(m.rawVolume).toBe(0n);
    expect(m.organicVolumeBps).toBe(0);
  });
});

describe("evidenceRoot", () => {
  it("is order-independent and changes when evidence changes", () => {
    const c1 = cluster(["0xa", "0xb"]);
    const c2 = cluster(["0xc", "0xd"]);
    const r1 = evidenceRoot("0x70", 100, [c1, c2]).root;
    const r2 = evidenceRoot("0x70", 100, [c2, { ...c1, members: [...c1.members].reverse() }]).root;
    expect(r1).toBe(r2);
    expect(r1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(evidenceRoot("0x70", 101, [c1, c2]).root).not.toBe(r1);
    const changed = { ...c1, links: [{ ...c1.links[0]!, evidence: [{ ...c1.links[0]!.evidence[0]!, txHash: "0xother" }] }] };
    expect(evidenceRoot("0x70", 100, [changed, c2]).root).not.toBe(r1);
  });
});
