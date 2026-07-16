import { describe, it, expect } from "vitest";
import { computeThisMonthSummary } from "./thisMonthSummary";
import type { EngineAccount, EngineParticular } from "@/lib/engine";

// Today is mid-month so we exercise both reverse (past) and forward (future) replay.
const today = new Date(Date.UTC(2026, 6, 15)); // 15 Jul 2026

const debit = (currentBalance: number): EngineAccount => ({
  id: "a1", type: "DEBIT", anchorBalance: currentBalance, anchorDate: today, creditLimit: null,
});

function once(
  id: string, type: EngineParticular["type"], amount: number, day: number,
  extra: Partial<EngineParticular> = {},
): EngineParticular {
  return {
    id, name: id, type, accountId: "a1", toAccountId: null, amount,
    frequency: "ONCE_OFF", startDate: new Date(Date.UTC(2026, 6, day)), endDate: null,
    isCritical: false, isFixed: false, businessDayAdjustment: "NONE", overrides: [],
    ...extra,
  };
}

describe("computeThisMonthSummary", () => {
  it("reverses past events to recover the start-of-month balance", () => {
    // Salary of 2000 landed on the 1st, rent of 500 paid on the 5th → both already
    // reflected in today's balance of 3000. Start-of-month = 3000 - 2000 + 500 = 1500.
    const s = computeThisMonthSummary({
      accounts: [debit(3000)],
      particulars: [once("salary", "INCOME", 2000, 1), once("rent", "EXPENSE", 500, 5)],
      holidays: [], today, skipToday: false,
    });
    expect(s.startBalance).toBe(1500);
  });

  it("forward-replays future events into the end-of-month balance", () => {
    // Bill of 800 due on the 20th (future). End-of-month = 3000 - 800 = 2200.
    const s = computeThisMonthSummary({
      accounts: [debit(3000)],
      particulars: [once("bill", "EXPENSE", 800, 20)],
      holidays: [], today, skipToday: false,
    });
    expect(s.endBalance).toBe(2200);
    expect(s.startBalance).toBe(3000); // nothing happened before today
  });

  it("totals income and expenses across the whole month and reconciles net change", () => {
    const s = computeThisMonthSummary({
      accounts: [debit(3000)],
      particulars: [
        once("salary", "INCOME", 2000, 1),
        once("rent", "EXPENSE", 500, 5),
        once("bill", "EXPENSE", 800, 20),
      ],
      holidays: [], today, skipToday: false,
    });
    expect(s.totalIncome).toBe(2000);
    expect(s.totalExpenses).toBe(-1300);
    expect(s.netChange).toBe(700);
    // net change must reconcile the two projected endpoints
    expect(s.endBalance - s.startBalance).toBe(s.netChange);
  });

  it("drops today's events (and their totals) when skip-today is on", () => {
    const withToday = { accounts: [debit(3000)], holidays: [], today };
    const on = computeThisMonthSummary({
      ...withToday, particulars: [once("today", "EXPENSE", 100, 15)], skipToday: true,
    });
    expect(on.endBalance).toBe(3000);
    expect(on.totalExpenses).toBe(0);
  });

  it("excludes transfers from in/out totals and nets them to zero on the balance", () => {
    const s = computeThisMonthSummary({
      accounts: [debit(3000)],
      particulars: [once("move", "TRANSFER", 400, 10, { toAccountId: "a2" })],
      holidays: [], today, skipToday: false,
    });
    expect(s.totalIncome).toBe(0);
    expect(s.totalExpenses).toBe(0);
    expect(s.startBalance).toBe(3000);
    expect(s.endBalance).toBe(3000);
  });

  it("adds available credit into the combined current balance", () => {
    const credit: EngineAccount = {
      id: "c1", type: "CREDIT", anchorBalance: -200, anchorDate: today, creditLimit: 1000,
    };
    // combined current = 3000 (debit) + (1000 - 200) available credit = 3800
    const s = computeThisMonthSummary({
      accounts: [debit(3000), credit],
      particulars: [], holidays: [], today, skipToday: false,
    });
    expect(s.startBalance).toBe(3800);
    expect(s.endBalance).toBe(3800);
  });
});
