import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, budgetLevel, importAllowed, projectBytes } from "./storage.js";

describe("storage budget", () => {
  it("classifies sizes against the SPEC thresholds", () => {
    expect(budgetLevel(1_000_000_000)).toBe("ok");
    expect(budgetLevel(DEFAULT_BUDGET.targetBytes)).toBe("ok");
    expect(budgetLevel(2_000_000_000)).toBe("over_target");
    expect(budgetLevel(DEFAULT_BUDGET.alarmBytes)).toBe("alarm");
    expect(budgetLevel(DEFAULT_BUDGET.hardStopBytes)).toBe("hard_stop");
  });
  it("projects linearly from the measured window", () => {
    expect(projectBytes(10_000_000, 1, 7)).toBe(70_000_000);
    expect(projectBytes(30_000_000, 2, 7)).toBe(105_000_000);
    expect(() => projectBytes(1, 0, 7)).toThrow();
  });
  it("gates imports at the target", () => {
    expect(importAllowed(DEFAULT_BUDGET.targetBytes)).toBe(true);
    expect(importAllowed(DEFAULT_BUDGET.targetBytes + 1)).toBe(false);
  });
});
