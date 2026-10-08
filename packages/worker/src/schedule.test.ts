import { describe, expect, it } from "vitest";
import { nextSteps, type ScheduleState } from "./schedule.js";

const cfg = { minIntervalMs: 60_000, heartbeatMs: 3_600_000, retryMs: 60_000 };
const st = (over: Partial<ScheduleState>): ScheduleState => ({
  dirty: false,
  lastMetricsAt: 0,
  lastPublishAttemptAt: 0,
  publishPending: false,
  ...over,
});

describe("nextSteps", () => {
  it("does nothing when idle and within the heartbeat", () => {
    expect(nextSteps(st({}), 1000, cfg)).toEqual({ metrics: false, publish: false });
  });
  it("recomputes and publishes when dirty and past the debounce interval", () => {
    expect(nextSteps(st({ dirty: true }), 60_000, cfg)).toEqual({ metrics: true, publish: true });
  });
  it("debounces bursts of activity", () => {
    expect(nextSteps(st({ dirty: true, lastMetricsAt: 30_000, lastPublishAttemptAt: 30_000 }), 60_000, cfg)).toEqual({
      metrics: false,
      publish: false,
    });
  });
  it("publishes a heartbeat even without new activity", () => {
    expect(nextSteps(st({}), 3_600_000, cfg)).toEqual({ metrics: false, publish: true });
  });
  it("retries a failed publish after retryMs, not in a hot loop", () => {
    const failed = st({ publishPending: true, lastPublishAttemptAt: 100_000 });
    expect(nextSteps(failed, 110_000, cfg).publish).toBe(false);
    expect(nextSteps(failed, 160_000, cfg).publish).toBe(true);
  });
  it("does not wait for the heartbeat to retry pending changes", () => {
    const failed = st({ publishPending: true, lastPublishAttemptAt: 0 });
    expect(nextSteps(failed, cfg.retryMs, cfg).publish).toBe(true);
  });
});
