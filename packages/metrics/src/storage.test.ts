import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, budgetFromEnv, budgetLevel, projectBytes } from "./storage.js";

describe("storage budget (SQLite file on the data branch)", () => {
  it("classifies sizes against 40 / 70 / 90 MB", () => {
    expect(DEFAULT_BUDGET).toEqual({ targetBytes: 40_000_000, alarmBytes: 70_000_000, hardStopBytes: 90_000_000 });
    expect(budgetLevel(1_000_000)).toBe("ok");
    expect(budgetLevel(40_000_000)).toBe("ok");
    expect(budgetLevel(50_000_000)).toBe("over_target");
    expect(budgetLevel(70_000_000)).toBe("alarm");
    expect(budgetLevel(90_000_000)).toBe("hard_stop");
  });
  it("projects linearly from the measured window", () => {
    expect(projectBytes(184_320, 1, 7)).toBe(1_290_240);
    expect(() => projectBytes(1, 0, 7)).toThrow();
  });
  it("reads overrides from env and rejects bad values", () => {
    expect(budgetFromEnv({ STORAGE_TARGET_BYTES: "30000000" }).targetBytes).toBe(30_000_000);
    expect(budgetFromEnv({}).hardStopBytes).toBe(90_000_000);
    expect(() => budgetFromEnv({ STORAGE_ALARM_BYTES: "70MB" })).toThrow();
  });
});
