import { describe, it, expect } from "vitest";
import { toMonthly, buildBudget } from "./budget";

describe("toMonthly", () => {
  it("converts each frequency to a monthly-equivalent", () => {
    expect(toMonthly(120, "MONTHLY")).toBe(120);
    expect(toMonthly(1200, "ANNUAL")).toBe(100);
    expect(toMonthly(100, "WEEKLY")).toBeCloseTo(100 * 52 / 12);
    expect(toMonthly(100, "FORTNIGHTLY")).toBeCloseTo(100 * 26 / 12);
    expect(toMonthly(500, "ONCE_OFF")).toBe(0);
  });
});

describe("buildBudget", () => {
  it("groups expenses by category, computes untagged, totals, and surplus", () => {
    const s = buildBudget([
      { type: "INCOME", amount: 5000, frequency: "MONTHLY" },
      { type: "EXPENSE", amount: 1200, frequency: "MONTHLY", category: "Rent" },
      { type: "EXPENSE", amount: 600, frequency: "MONTHLY", category: "Groceries" },
      { type: "EXPENSE", amount: 200, frequency: "MONTHLY", category: null },
    ]);
    expect(s.categories).toEqual([
      { name: "Rent", monthly: 1200 },
      { name: "Groceries", monthly: 600 },
    ]);
    expect(s.untagged).toBe(200);
    expect(s.totalExpense).toBe(2000);
    expect(s.monthlyIncome).toBe(5000);
    expect(s.surplus).toBe(3000);
  });

  it("aggregates multiple expenses sharing a category and normalizes frequency", () => {
    const s = buildBudget([
      { type: "EXPENSE", amount: 1200, frequency: "ANNUAL", category: "Insurance" }, // 100/mo
      { type: "EXPENSE", amount: 50, frequency: "WEEKLY", category: "Insurance" },   // 216.67/mo
    ]);
    expect(s.categories[0]?.name).toBe("Insurance");
    expect(s.categories[0]?.monthly).toBeCloseTo(100 + 50 * 52 / 12);
  });

  it("reports a negative surplus (deficit) when expenses exceed income", () => {
    const s = buildBudget([
      { type: "INCOME", amount: 1000, frequency: "MONTHLY" },
      { type: "EXPENSE", amount: 1500, frequency: "MONTHLY", category: "Rent" },
    ]);
    expect(s.surplus).toBe(-500);
  });

  it("excludes once-offs and handles empty input", () => {
    expect(buildBudget([])).toEqual({
      categories: [], untagged: 0, totalExpense: 0, monthlyIncome: 0, surplus: 0,
    });
    const s = buildBudget([
      { type: "EXPENSE", amount: 999, frequency: "ONCE_OFF", category: "Holiday" },
    ]);
    expect(s.totalExpense).toBe(0);
    expect(s.categories).toEqual([]);
  });
});
