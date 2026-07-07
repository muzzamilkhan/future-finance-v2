import { describe, it, expect } from "vitest";
import { toDebtChartData } from "./debtChartData";
import type { SimulateResult, DebtMonth } from "@/lib/engine";

function month(m: number, perDebt: { id: string; endBalance: number }[]): DebtMonth {
  return {
    month: m,
    perDebt: perDebt.map((p) => ({
      id: p.id,
      startBalance: 0,
      interest: 0,
      payment: 0,
      endBalance: p.endBalance,
    })),
    totalBalance: perDebt.reduce((s, p) => s + Math.max(0, p.endBalance), 0),
    totalInterest: 0,
    totalPaid: 0,
  };
}

function result(months: DebtMonth[]): SimulateResult {
  return { months, payoffMonth: null, totalInterest: 0, totalPaid: 0, perDebt: [] };
}

describe("toDebtChartData", () => {
  it("preserves month order and emits one key per debt id", () => {
    const r = result([
      month(0, [{ id: "a", endBalance: 100 }, { id: "b", endBalance: 200 }]),
      month(1, [{ id: "a", endBalance: 50 }, { id: "b", endBalance: 180 }]),
    ]);
    const rows = toDebtChartData(r, ["a", "b"]);
    expect(rows.map((x) => x.month)).toEqual([0, 1]);
    expect(rows[0]).toEqual({ month: 0, a: 100, b: 200 });
    expect(rows[1]).toEqual({ month: 1, a: 50, b: 180 });
  });

  it("clamps paid-off / negative balances to 0", () => {
    const r = result([month(0, [{ id: "a", endBalance: -0.004 }, { id: "b", endBalance: 10 }])]);
    const rows = toDebtChartData(r, ["a", "b"]);
    expect(rows[0]!.a).toBe(0);
    expect(rows[0]!.b).toBe(10);
  });

  it("rounds to cents", () => {
    const r = result([month(0, [{ id: "a", endBalance: 33.333333 }])]);
    expect(toDebtChartData(r, ["a"])[0]!.a).toBe(33.33);
  });

  it("fills 0 for a debt absent from a month's perDebt", () => {
    const r = result([month(0, [{ id: "a", endBalance: 100 }])]);
    const rows = toDebtChartData(r, ["a", "b"]);
    expect(rows[0]).toEqual({ month: 0, a: 100, b: 0 });
  });

  it("adds a baseline total from the comparison sim when provided", () => {
    const active = result([
      month(0, [{ id: "a", endBalance: 100 }]),
      month(1, [{ id: "a", endBalance: 40 }]),
    ]);
    const baseline = result([
      month(0, [{ id: "a", endBalance: 120 }]),
      month(1, [{ id: "a", endBalance: 90 }]),
    ]);
    const rows = toDebtChartData(active, ["a"], baseline);
    expect(rows[0]).toEqual({ month: 0, a: 100, baseline: 120 });
    expect(rows[1]).toEqual({ month: 1, a: 40, baseline: 90 });
  });

  it("extends rows over the longer baseline timeline", () => {
    const active = result([month(0, [{ id: "a", endBalance: 100 }])]);
    const baseline = result([
      month(0, [{ id: "a", endBalance: 120 }]),
      month(1, [{ id: "a", endBalance: 60 }]),
      month(2, [{ id: "a", endBalance: 0 }]),
    ]);
    const rows = toDebtChartData(active, ["a"], baseline);
    expect(rows.map((r) => r.month)).toEqual([0, 1, 2]);
    // active finished at month 0, so its debt bands are 0 past its end
    expect(rows[1]).toEqual({ month: 1, a: 0, baseline: 60 });
    expect(rows[2]).toEqual({ month: 2, a: 0, baseline: 0 });
  });

  it("omits the baseline key entirely when no comparison sim is given", () => {
    const r = result([month(0, [{ id: "a", endBalance: 100 }])]);
    const rows = toDebtChartData(r, ["a"]);
    expect("baseline" in rows[0]!).toBe(false);
  });
});
