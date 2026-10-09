/**
 * Storage budget for the SQLite file committed to the `data` branch (GitHub rejects files over
 * 100 MB). Thresholds come from env with these defaults; never raise them without the user's
 * explicit approval.
 */
export interface Budget {
  targetBytes: number;
  alarmBytes: number;
  hardStopBytes: number;
}

export const DEFAULT_BUDGET: Budget = { targetBytes: 40_000_000, alarmBytes: 70_000_000, hardStopBytes: 90_000_000 };

export type BudgetLevel = "ok" | "over_target" | "alarm" | "hard_stop";

export function budgetLevel(bytes: number, b: Budget = DEFAULT_BUDGET): BudgetLevel {
  if (bytes >= b.hardStopBytes) return "hard_stop";
  if (bytes >= b.alarmBytes) return "alarm";
  if (bytes > b.targetBytes) return "over_target";
  return "ok";
}

/** Linear projection of DB size for `targetDays` from the size measured over `measuredDays`. */
export function projectBytes(bytes: number, measuredDays: number, targetDays: number): number {
  if (measuredDays <= 0) throw new Error("measuredDays must be > 0");
  return Math.round((bytes / measuredDays) * targetDays);
}

/** Budget from env (STORAGE_TARGET_BYTES / STORAGE_ALARM_BYTES / STORAGE_HARD_STOP_BYTES) with defaults. */
export function budgetFromEnv(env: Record<string, string | undefined>): Budget {
  const n = (k: string, d: number) => {
    const v = env[k]?.trim();
    if (!v) return d;
    const x = Number(v);
    if (!Number.isFinite(x) || x <= 0) throw new Error(`${k} must be a positive number, got "${v}"`);
    return x;
  };
  return {
    targetBytes: n("STORAGE_TARGET_BYTES", DEFAULT_BUDGET.targetBytes),
    alarmBytes: n("STORAGE_ALARM_BYTES", DEFAULT_BUDGET.alarmBytes),
    hardStopBytes: n("STORAGE_HARD_STOP_BYTES", DEFAULT_BUDGET.hardStopBytes),
  };
}
