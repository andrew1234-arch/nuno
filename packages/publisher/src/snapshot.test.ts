import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLISH_POLICY, shouldPublish, toSnapshot, type FeedSnapshot, type MetricsRow } from "./snapshot.js";

// Hand-built test fixtures (not real chain data).
const ROOT = `0x${"ab".repeat(32)}`;
const row: MetricsRow = {
  token: "0x70",
  sourceBlock: 1000,
  rawHolders: 120,
  realHolders: 40,
  effectiveTop10Bps: 6500,
  clusterSupplyBps: 4200,
  creatorLinkedSupplyBps: 1200,
  organicVolumeBps: 3100,
  evidenceRoot: ROOT,
};

describe("toSnapshot", () => {
  it("maps a metrics row to the feed struct", () => {
    expect(toSnapshot(row)).toEqual({
      sourceBlock: 1000n,
      publishedAt: 0n,
      rawHolders: 120,
      realHolders: 40,
      clusterSupplyBps: 4200,
      effectiveTop10Bps: 6500,
      creatorLinkedSupplyBps: 1200,
      organicVolumeBps: 3100,
      evidenceRoot: ROOT,
    });
  });

  it.each([
    [{ clusterSupplyBps: 10_001 }],
    [{ organicVolumeBps: -1 }],
    [{ effectiveTop10Bps: 1.5 }],
    [{ realHolders: 121 }],
    [{ rawHolders: 2 ** 32, realHolders: 0 }],
    [{ evidenceRoot: "0x1234" }],
  ])("rejects out-of-range values %o", (bad) => {
    expect(() => toSnapshot({ ...row, ...bad })).toThrow();
  });
});

describe("shouldPublish", () => {
  const now = 1_800_000_000;
  const onChain = (over: Partial<FeedSnapshot> = {}): FeedSnapshot => ({ ...toSnapshot(row), publishedAt: BigInt(now - 60), ...over });
  const next = (over: Partial<MetricsRow> = {}) => toSnapshot({ ...row, sourceBlock: 2000, ...over });

  it("publishes when nothing is on-chain", () => {
    expect(shouldPublish(onChain({ publishedAt: 0n }), next(), now).publish).toBe(true);
  });

  it("skips unchanged data within the heartbeat", () => {
    expect(shouldPublish(onChain(), next(), now)).toEqual({ publish: false, reason: "no meaningful change" });
  });

  it("publishes on holder changes", () => {
    expect(shouldPublish(onChain(), next({ realHolders: 39 }), now).publish).toBe(true);
  });

  it("publishes on bps moves at or above the threshold only", () => {
    expect(shouldPublish(onChain(), next({ clusterSupplyBps: 4200 + DEFAULT_PUBLISH_POLICY.minBpsDelta }), now).publish).toBe(true);
    expect(shouldPublish(onChain(), next({ organicVolumeBps: 3100 - DEFAULT_PUBLISH_POLICY.minBpsDelta + 1 }), now).publish).toBe(false);
  });

  it("publishes when the evidence changes", () => {
    expect(shouldPublish(onChain(), next({ evidenceRoot: `0x${"cd".repeat(32)}` }), now).reason).toBe("evidence changed");
  });

  it("publishes a heartbeat after heartbeatSecs", () => {
    const old = onChain({ publishedAt: BigInt(now - DEFAULT_PUBLISH_POLICY.heartbeatSecs) });
    expect(shouldPublish(old, next(), now).reason).toBe("heartbeat");
  });

  it("never publishes data older than the on-chain snapshot", () => {
    const prev = onChain({ sourceBlock: 5000n, publishedAt: 1n });
    expect(shouldPublish(prev, next({ realHolders: 1 }), now).publish).toBe(false);
  });
});
