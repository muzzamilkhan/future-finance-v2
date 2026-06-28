import { describe, it, expect } from "vitest";
import { particularInput } from "./particular";

describe("particularInput", () => {
  it("rejects a non-positive amount", () => {
    const r = particularInput.safeParse({
      name: "Rent", type: "EXPENSE", amount: 0, frequency: "MONTHLY",
      startDate: new Date(), isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid particular", () => {
    const r = particularInput.safeParse({
      name: "Rent", type: "EXPENSE", amount: 1500, frequency: "MONTHLY",
      startDate: new Date(), isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an endDate before startDate", () => {
    const r = particularInput.safeParse({
      name: "Rent", type: "EXPENSE", amount: 1500, frequency: "MONTHLY",
      startDate: new Date("2026-06-28"), endDate: new Date("2026-06-01"),
      isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    });
    expect(r.success).toBe(false);
  });

  it("accepts an endDate on or after startDate", () => {
    const r = particularInput.safeParse({
      name: "Rent", type: "EXPENSE", amount: 1500, frequency: "MONTHLY",
      startDate: new Date("2026-06-28"), endDate: new Date("2026-06-28"),
      isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    });
    expect(r.success).toBe(true);
  });
});
