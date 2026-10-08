/**
 * Storage budget (SPEC §7.11). Thresholds come from env with the SPEC defaults; never raise them
 * without the user's explicit approval (CLAUDE.md rule 8).
 */
export interface Budget {
  targetBytes: number;
  alarmBytes: number;
  hardStopBytes: number;
}

export const DEFAULT_BUDGET: Budget = { targetBytes: 1_500_000_000, alarmBytes: 2_500_000_000, hardStopBytes: 3_000_000_000 };

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

/** Import gate: refuse to import a local DB over the target (SPEC §7.11). */
export function importAllowed(bytes: number, b: Budget = DEFAULT_BUDGET): boolean {
  return bytes <= b.targetBytes;
}
