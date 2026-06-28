import { describe, it, expect } from "vitest";
import { toEngineParticular } from "./mappers";

const decimal = (n: number) => ({ toString: () => String(n) }) as unknown as { toString(): string };

describe("toEngineParticular", () => {
  it("maps Decimal amount to a positive number", () => {
    const e = toEngineParticular({
      id: "p1", name: "Rent", type: "EXPENSE", amount: decimal(1500),
      frequency: "MONTHLY", startDate: new Date("2026-07-01"), endDate: null,
      isCritical: true, isFixed: true, businessDayAdjustment: "NONE", overrides: [],
    } as never);
    expect(e.amount).toBe(1500);
    expect(e.type).toBe("EXPENSE");
  });

  it("maps override Decimal amounts and null dates", () => {
    const e = toEngineParticular({
      id: "p1", name: "Rent", type: "EXPENSE", amount: decimal(1500),
      frequency: "MONTHLY", startDate: new Date("2026-07-01"), endDate: null,
      isCritical: false, isFixed: false, businessDayAdjustment: "NONE",
      overrides: [{ id: "o1", originalDate: new Date("2026-08-01"),
        overriddenDate: null, overriddenAmount: decimal(1600), isSkipped: false }],
    } as never);
    expect(e.overrides[0]!.overriddenAmount).toBe(1600);
    expect(e.overrides[0]!.overriddenDate).toBeNull();
  });
});
