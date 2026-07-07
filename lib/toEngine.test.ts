import { describe, it, expect } from "vitest";
import { toEngineInputs, toCombinedEngineInputs } from "./toEngine";

describe("toEngineInputs", () => {
  it("maps forecast.getData rows to engine inputs, anchoring at today", () => {
    const today = new Date("2026-07-07T00:00:00Z");
    const out = toEngineInputs({
      account: { currentBalance: 1000, balanceUpdatedAt: new Date("2026-07-01") },
      particulars: [{
        id: "p1", name: "Rent", type: "EXPENSE", amount: "1500", frequency: "MONTHLY",
        startDate: new Date("2026-07-01"), endDate: null, isCritical: true, isFixed: true,
        businessDayAdjustment: "NONE", overrides: [],
      }],
      holidays: [{ date: new Date("2026-12-25"), isRecurring: true }],
    } as never, today);
    expect(out.anchorBalance).toBe(1000);
    // Anchored at today, not the account's balanceUpdatedAt.
    expect(out.anchorDate.getTime()).toBe(today.getTime());
    expect(out.particulars[0]!.amount).toBe(1500);
    expect(out.holidays[0]!.isRecurring).toBe(true);
  });
});

const combinedPayload = {
  accounts: [
    { id: "debit", name: "My Account", type: "DEBIT" as const, currentBalance: 1000, balanceUpdatedAt: new Date("2026-01-01"), creditLimit: null },
    { id: "credit", name: "Visa", type: "CREDIT" as const, currentBalance: -200, balanceUpdatedAt: new Date("2026-01-01"), creditLimit: 1000 },
  ],
  particulars: [
    { id: "t", name: "Card payment", type: "TRANSFER" as const, accountId: "debit", toAccountId: "credit", amount: "100",
      frequency: "ONCE_OFF" as const, startDate: new Date("2026-01-10"), endDate: null,
      isCritical: true, isFixed: true, businessDayAdjustment: "NONE" as const, overrides: [] },
  ],
  holidays: [],
};

describe("toCombinedEngineInputs", () => {
  it("maps accounts and transfer routing, anchoring every account at today", () => {
    const today = new Date("2026-07-07T00:00:00Z");
    const out = toCombinedEngineInputs(combinedPayload, today);
    expect(out.accounts).toHaveLength(2);
    expect(out.accounts[1]).toMatchObject({ id: "credit", type: "CREDIT", anchorBalance: -200, creditLimit: 1000 });
    // Both accounts anchor at today regardless of their balanceUpdatedAt.
    expect(out.accounts[0]!.anchorDate.getTime()).toBe(today.getTime());
    expect(out.accounts[1]!.anchorDate.getTime()).toBe(today.getTime());
    expect(out.particulars[0]).toMatchObject({ accountId: "debit", toAccountId: "credit", type: "TRANSFER", amount: 100 });
  });
});
