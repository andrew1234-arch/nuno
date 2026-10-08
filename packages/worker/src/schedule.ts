/**
 * Decides when the expensive steps run. Pure, so the timing policy is unit-tested.
 * - Metrics recompute only when new activity arrived ("dirty") and at most every `minIntervalMs`.
 * - Publishing runs after every recompute; after a failed attempt it is retried every `retryMs`
 *   (never in a hot loop, never left until the next heartbeat); otherwise it runs every
 *   `heartbeatMs` (the publisher's own policy decides per token whether anything is sent).
 */
export interface ScheduleState {
  dirty: boolean;
  lastMetricsAt: number;
  lastPublishAttemptAt: number;
  /** New metrics not yet fully published (set by a recompute, cleared by a fully successful publish). */
  publishPending: boolean;
}

export interface ScheduleConfig {
  minIntervalMs: number;
  heartbeatMs: number;
  retryMs: number;
}

export function nextSteps(s: ScheduleState, now: number, cfg: ScheduleConfig): { metrics: boolean; publish: boolean } {
  const metrics = s.dirty && now - s.lastMetricsAt >= cfg.minIntervalMs;
  const sinceAttempt = now - s.lastPublishAttemptAt;
  const publish = metrics || (s.publishPending && sinceAttempt >= cfg.retryMs) || sinceAttempt >= cfg.heartbeatMs;
  return { metrics, publish };
}
