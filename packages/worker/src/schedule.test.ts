import { describe, expect, it } from "vitest";
import { nextSteps } from "./schedule.js";

const cfg = { minIntervalMs: 60_000, heartbeatMs: 3_600_000 };

describe("nextSteps", () => {
  it("does nothing when idle and within the heartbeat", () => {
    expect(nextSteps({ dirty: false, lastMetricsAt: 0, lastPublishAt: 0 }, 1000, cfg)).toEqual({ metrics: false, publish: false });
  });
  it("recomputes and publishes when dirty and past the debounce interval", () => {
    expect(nextSteps({ dirty: true, lastMetricsAt: 0, lastPublishAt: 0 }, 60_000, cfg)).toEqual({ metrics: true, publish: true });
  });
  it("debounces bursts of activity", () => {
    expect(nextSteps({ dirty: true, lastMetricsAt: 30_000, lastPublishAt: 30_000 }, 60_000, cfg)).toEqual({ metrics: false, publish: false });
  });
  it("publishes a heartbeat even without new activity", () => {
    expect(nextSteps({ dirty: false, lastMetricsAt: 0, lastPublishAt: 0 }, 3_600_000, cfg)).toEqual({ metrics: false, publish: true });
  });
});
