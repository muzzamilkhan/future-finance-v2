import { describe, it, expect } from "vitest";
import { toPieData } from "./budgetChartData";
import type { BudgetSummary } from "@/lib/budget/budget";

const base: BudgetSummary = {
  categories: [{ name: "Rent", monthly: 1200 }, { name: "Food", monthly: 600 }],
  untagged: 0, totalExpense: 1800, monthlyIncome: 3000, surplus: 1200,
};

describe("toPieData", () => {
  it("adds a surplus slice when income exceeds expenses", () => {
    const d = toPieData(base);
    expect(d).toContainEqual({ name: "Surplus", value: 1200, kind: "surplus" });
    expect(d.filter((x) => x.kind === "category")).toHaveLength(2);
  });
  it("adds an untagged slice only when untagged > 0", () => {
    expect(toPieData(base).some((x) => x.kind === "untagged")).toBe(false);
    const d = toPieData({ ...base, untagged: 100, totalExpense: 1900 });
    expect(d).toContainEqual({ name: "Untagged", value: 100, kind: "untagged" });
  });
  it("never adds a surplus slice on a deficit", () => {
    const d = toPieData({ ...base, monthlyIncome: 1000, surplus: -800 });
    expect(d.some((x) => x.kind === "surplus")).toBe(false);
  });
});
