import { describe, it, expect } from "vitest";
import { toEngineInputs } from "./toEngine";

describe("toEngineInputs", () => {
  it("maps forecast.getData rows to engine inputs with positive amounts", () => {
    const out = toEngineInputs({
      account: { currentBalance: 1000, balanceUpdatedAt: new Date("2026-07-01") },
      particulars: [{
        id: "p1", name: "Rent", type: "EXPENSE", amount: "1500", frequency: "MONTHLY",
        startDate: new Date("2026-07-01"), endDate: null, isCritical: true, isFixed: true,
        businessDayAdjustment: "NONE", overrides: [],
      }],
      holidays: [{ date: new Date("2026-12-25"), isRecurring: true }],
    } as never);
    expect(out.anchorBalance).toBe(1000);
    expect(out.particulars[0]!.amount).toBe(1500);
    expect(out.holidays[0]!.isRecurring).toBe(true);
  });
});
