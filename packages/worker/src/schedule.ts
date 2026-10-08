/**
 * Decides when the expensive steps run. Pure, so the timing policy is unit-tested.
 * - Metrics recompute only when new activity arrived ("dirty") and at most every `minIntervalMs`.
 * - Publishing follows a recompute, or runs on its own every `heartbeatMs` (the publisher's own
 *   policy then decides per token whether anything is sent).
 */
export interface ScheduleState {
  dirty: boolean;
  lastMetricsAt: number;
  lastPublishAt: number;
}

export interface ScheduleConfig {
  minIntervalMs: number;
  heartbeatMs: number;
}

export function nextSteps(s: ScheduleState, now: number, cfg: ScheduleConfig): { metrics: boolean; publish: boolean } {
  const metrics = s.dirty && now - s.lastMetricsAt >= cfg.minIntervalMs;
  const publish = metrics || now - s.lastPublishAt >= cfg.heartbeatMs;
  return { metrics, publish };
}
