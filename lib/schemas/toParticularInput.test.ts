import { describe, it, expect } from "vitest";
import { particularInput } from "./particular";
import { toParticularInput } from "./toParticularInput";

const base = {
  name: "Rent",
  type: "EXPENSE" as const,
  amount: "2000",
  frequency: "MONTHLY" as const,
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: null as Date | null,
  isCritical: true,
  isFixed: true,
  businessDayAdjustment: "NONE" as const,
  category: "Housing" as string | null,
};

describe("toParticularInput", () => {
  it("round-trips to a valid particularInput", () => {
    const result = particularInput.safeParse(toParticularInput(base));
    expect(result.success).toBe(true);
  });

  it("maps null category to an empty string", () => {
    expect(toParticularInput({ ...base, category: null }).category).toBe("");
  });

  it("maps a once-off with no endDate to undefined endDate", () => {
    const mapped = toParticularInput({ ...base, frequency: "ONCE_OFF", endDate: null });
    expect(mapped.endDate).toBeUndefined();
  });

  it("carries endDate through as a Date when present", () => {
    const end = new Date("2026-12-31T00:00:00Z");
    expect(toParticularInput({ ...base, endDate: end }).endDate).toEqual(end);
  });

  it("uses the absolute value of the amount", () => {
    expect(toParticularInput({ ...base, amount: "-2000" }).amount).toBe(2000);
  });

  it("carries TRANSFER type and toAccountId", () => {
    const out = toParticularInput({
      name: "Card payment", type: "TRANSFER", amount: 100, frequency: "ONCE_OFF",
      startDate: "2026-01-10", endDate: null, isCritical: true, isFixed: true,
      businessDayAdjustment: "NONE", category: null, accountId: "debit", toAccountId: "credit",
    } as never);
    expect(out.type).toBe("TRANSFER");
    expect((out as { toAccountId?: string }).toAccountId).toBe("credit");
  });
});
