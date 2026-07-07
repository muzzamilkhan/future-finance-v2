import type { SimulateResult } from "@/lib/engine";

/** One recharts row: the month index plus each debt's remaining balance by id. */
export type DebtChartRow = { month: number } & Record<string, number>;

/**
 * Shape a payoff simulation into stacked-area rows — one row per month, one
 * numeric key per debt id carrying that debt's end-of-month balance. Balances
 * are clamped to ≥ 0 and rounded to cents (matching the old total line). A debt
 * missing from a month's `perDebt` (shouldn't happen, but defensively) yields 0
 * so the band stays continuous.
 */
export function toDebtChartData(
  result: SimulateResult,
  debtIds: string[],
): DebtChartRow[] {
  return result.months.map((m) => {
    const byId = new Map(m.perDebt.map((p) => [p.id, p.endBalance] as const));
    const row: DebtChartRow = { month: m.month };
    for (const id of debtIds) {
      const bal = byId.get(id) ?? 0;
      row[id] = Math.round(Math.max(0, bal) * 100) / 100;
    }
    return row;
  });
}
