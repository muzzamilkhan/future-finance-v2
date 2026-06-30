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

  it.each([
    ["empty string", ""],
    ["null", null],
    ["undefined", undefined],
  ])("treats %s endDate as no end date", (_label, endDate) => {
      const r = particularInput.safeParse({
        name: "Rent", type: "EXPENSE", amount: 1500, frequency: "MONTHLY",
        startDate: new Date("2026-06-28"), endDate,
        isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.endDate).toBeUndefined();
    },
  );
});

const base = {
  name: "x", amount: 100, frequency: "ONCE_OFF" as const,
  startDate: "2026-01-10", isCritical: true, isFixed: true, businessDayAdjustment: "NONE" as const,
};

it("TRANSFER requires a distinct toAccountId", () => {
  expect(particularInput.safeParse({ ...base, type: "TRANSFER", accountId: "a", toAccountId: "b" }).success).toBe(true);
  expect(particularInput.safeParse({ ...base, type: "TRANSFER", accountId: "a" }).success).toBe(false);
  expect(particularInput.safeParse({ ...base, type: "TRANSFER", accountId: "a", toAccountId: "a" }).success).toBe(false);
});

it("INCOME/EXPENSE must not carry a toAccountId", () => {
  expect(particularInput.safeParse({ ...base, type: "EXPENSE", toAccountId: "b" }).success).toBe(false);
  expect(particularInput.safeParse({ ...base, type: "EXPENSE" }).success).toBe(true);
});

describe("particularInput category", () => {
  const base = { name: "Power", type: "EXPENSE", amount: 100, frequency: "MONTHLY", startDate: "2026-06-01" };
  it("normalizes a provided category", () => {
    const parsed = particularInput.parse({ ...base, category: "  power  bills " });
    expect(parsed.category).toBe("Power Bills");
  });
  it("treats blank category as undefined", () => {
    const parsed = particularInput.parse({ ...base, category: "   " });
    expect(parsed.category).toBeUndefined();
  });
  it("allows omitting category", () => {
    const parsed = particularInput.parse(base);
    expect(parsed.category).toBeUndefined();
  });
});
