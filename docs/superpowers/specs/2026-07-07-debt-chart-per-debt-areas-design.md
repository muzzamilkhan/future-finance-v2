# Debt forecast chart — per-debt stacked areas

Date: 2026-07-07

## Goal

The Debt Buster forecast chart (`app/debts/DebtForecastChart.tsx`) currently draws a
single line for the **total** remaining balance across all debts. Replace it with a
**stacked area chart** where each debt is its own colored band. The top edge of the
stack still equals the total balance — preserving the existing "shrinks to zero" read —
while each band shows that debt's share and pinches to zero the month it is paid off.

## Non-goals

- No engine changes. `simulateDebtPayoff` already returns everything needed.
- No new chart types beyond the stacked area (no line overlay, no separate total line).
- No palette additions — reuse the app's existing `--chart-N` CSS variables.

## Data

`SimulateResult.months` is `DebtMonth[]`, each with:

- `month: number`
- `perDebt: PerDebtMonth[]` — one entry per input debt, in stable `input.debts` order,
  keyed by `id`, carrying `endBalance` (remaining balance at end of that month).
- `totalBalance: number`

The chart transforms `months` into recharts rows shaped:

```
{ month: number, [debtId: string]: number /* endBalance, clamped ≥ 0 */ }
```

One stacked `<Area>` is rendered per debt id. Because `perDebt` preserves input order and
`endBalance` is already `≥ 0` for paid-off debts (balance floors at 0), no reordering or
clamping surprises arise; we still `Math.max(0, …)` and round to cents defensively, matching
the current line's rounding.

## Color

Each debt gets a color by its **stable index** in the debt list, from the app's existing
theme-aware chart variables `--chart-1` … `--chart-5` (already used with recharts in
`app/_components/home/HomePage.tsx`). With more than 5 debts, wrap modulo 5.

- Color follows the **debt entity** (its index in the passed `debts` array), never its
  strategy rank — changing strategy or extra payment repaints nothing.
- Only 5 chart vars exist; the debt list is realistically small, so modulo-5 wrapping is
  acceptable (documented tradeoff; matches how `accountColor.ts` wraps its 6-color list).

## Component interface

`DebtForecastChart` gains a `debts` prop so it can label bands/tooltip with debt **names**
(the engine only carries ids):

```ts
function DebtForecastChart({
  result,
  debts,
}: {
  result: SimulateResult;
  debts: { id: string; name: string }[];
}): JSX.Element
```

`page.tsx` already has `debts` (the `DebtInput[]`) in scope and passes `result={sims.active}`;
it additionally passes `debts={debts}`. The component reads only `id` and `name`, so passing
the full `DebtInput[]` is fine.

Ordering: bands are drawn in `debts` order; the color index is that same order, keeping
color↔debt stable.

## Marks & interaction (per dataviz method)

- Stacked `<Area type="monotone" stackId="s" />`, one per debt, `dataKey={debt.id}`.
- Fill = the debt's `--chart-N` var at ~0.85 opacity; `stroke` = same var, 1.5px.
- Band separation: recharts stacked areas abut with no gap. Rather than a dedicated
  surface-colored spacer (awkward in recharts), rely on the per-series 1.5px same-hue
  stroke plus the fill-opacity contrast to keep adjacent bands legible.
- **Legend** (required for ≥2 series): a compact custom legend row above/below the chart
  mapping each color swatch to a debt name. For a single debt, the title/context already
  names it, but a legend with one entry is harmless; keep the legend whenever
  `debts.length >= 1` for simplicity.
- **Tooltip**: keep recharts `<Tooltip>` with a custom content renderer showing, for the
  hovered month: each debt's remaining balance (name + currency) and the total. Currency via
  `formatCurrency` (NZD), month via `Month N`. Entries with zero balance may be shown or
  hidden — hide fully-zero debts to reduce noise.
- Axes and their formatters (`${m}mo`, `formatCurrency`) are unchanged from today.

## Files touched

- `app/debts/DebtForecastChart.tsx` — rewrite chart body; add `debts` prop.
- `app/debts/page.tsx` — pass `debts={debts}` to `<DebtForecastChart>`.

No engine, schema, router, or migration changes.

## Testing

Per repo policy (pure-function tests only), the chart's data-shaping is the only testable
pure logic. If the row-building transform is extracted into a small pure helper
(`debtChartData.ts`), add a co-located `debtChartData.test.ts` covering:

- rows preserve month order and one key per debt id,
- paid-off debts contribute `0` (not negative),
- a debt absent from a later month still yields `0` for continuity.

If the transform stays trivial and inline, no test is added. Decision at implementation
time; extract-with-test is preferred since it is the one piece with real logic.
