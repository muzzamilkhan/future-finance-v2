import type { SimulateResult } from "@/lib/engine";

/** One recharts row: the month index plus each debt's remaining balance by id. */
export type DebtChartRow = { month: number } & Record<string, number>;

const round2 = (n: number) => Math.round(Math.max(0, n) * 100) / 100;

/**
 * Shape a payoff simulation into stacked-area rows — one row per month, one
 * numeric key per debt id carrying that debt's end-of-month balance. Balances
 * are clamped to ≥ 0 and rounded to cents (matching the old total line). A debt
 * missing from a month's `perDebt` (shouldn't happen, but defensively) yields 0
 * so the band stays continuous.
 *
 * When `baseline` (a comparison sim, e.g. the same strategy with no extra
 * payment) is provided, each row also carries a `baseline` key = that sim's
 * total balance for the month, and rows extend over the union of both
 * timelines so the (usually longer) baseline line shows its full tail.
 */
export function toDebtChartData(
  result: SimulateResult,
  debtIds: string[],
  baseline?: SimulateResult,
): DebtChartRow[] {
  const activeByMonth = new Map(result.months.map((m) => [m.month, m] as const));
  const baseTotalByMonth = baseline
    ? new Map(baseline.months.map((m) => [m.month, m.totalBalance] as const))
    : null;

  const lastMonth = Math.max(
    result.months.length ? result.months[result.months.length - 1]!.month : -1,
    baseline?.months.length ? baseline.months[baseline.months.length - 1]!.month : -1,
  );

  const rows: DebtChartRow[] = [];
  for (let month = 0; month <= lastMonth; month++) {
    const row: DebtChartRow = { month };
    const m = activeByMonth.get(month);
    const byId = new Map((m?.perDebt ?? []).map((p) => [p.id, p.endBalance] as const));
    for (const id of debtIds) {
      row[id] = round2(byId.get(id) ?? 0);
    }
    if (baseTotalByMonth) {
      row.baseline = round2(baseTotalByMonth.get(month) ?? 0);
    }
    rows.push(row);
  }
  return rows;
}
