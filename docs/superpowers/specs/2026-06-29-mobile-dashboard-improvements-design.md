# Mobile Dashboard Improvements — Design

**Date:** 2026-06-29
**Scope:** Mobile-only (`< sm` breakpoint) refinements to the dashboard at `app/page.tsx`. Desktop layout is unchanged.

## Problem

On mobile, the dashboard's top section (metric widgets + balance graph) takes up too much
vertical space, pushing the daily transaction cards below the fold. The graph shows no values
and gives no feedback when scrubbed. Daily card events appear in an arbitrary order.

## Goals

1. Make the top section (widgets + graph) more compact on mobile and **collapsible**.
2. **Auto-collapse** the top section when the user scrolls past it, pinning a slim sticky bar
   to the top so the daily cards are easy to scroll.
3. Graph shows its **lowest and highest** point values, and shows the **current point's value
   while scrubbing** (currently shows nothing).
4. Order each daily card's events: **income first, then expenses, each by amount descending**.

Non-goals: any desktop layout change; new data/persistence; changes to the forecast windowing.

## Design

### 1. Engine: add `highest`

`ForecastResult` currently exposes `lowest: DailyBalance | null`. Add a parallel
`highest: DailyBalance | null`, computed by reducing `days` to the max `closingBalance`
(mirroring the existing `lowest` reduce). When `days` is empty, `highest` is `null`.

This is the only change to `lib/engine/`. It is covered by a Vitest test in
`lib/engine/forecast.test.ts`, mirroring the existing "reports the lowest balance day" test.

### 2. Collapsible sticky top section

The metric widgets grid and the graph are wrapped in a collapsible top section. Behavior:

- **Mobile widgets are smaller** — tighter padding and smaller value/label text so four
  metrics fit with less vertical cost. Achieved with responsive Tailwind classes; desktop
  sizing is preserved.
- **Auto-collapse on scroll** — a zero-height sentinel element is placed just below the top
  section. An `IntersectionObserver` watches it; once it scrolls out of view above the
  viewport, the top section collapses. When it scrolls back into view, the section may expand
  (or remain collapsed until tapped — see below).
- **Sticky compact bar** — when collapsed, a slim bar pins to the top of the scroll area
  showing **current balance** and **lowest** (date + amount). Tapping the bar expands the
  full section again.
- **Manual toggle** — the compact bar is tappable to expand; the expanded section can be
  collapsed by tapping the same affordance. Auto-collapse drives the default state on scroll;
  an explicit user tap takes precedence until the next scroll-driven change.
- **Desktop** keeps the full grid, always expanded; the collapse/sticky behavior is gated to
  mobile (`< sm`).

State lives in `app/page.tsx` (`collapsed` boolean) and is driven by the observer plus the
tap handler. The sticky bar and observer wiring are extracted into a small client component
(e.g. `CollapsibleTopSection`) so `page.tsx` stays readable.

### 3. Graph (`BalanceSparkline`)

The sparkline becomes a small interactive chart:

- **Min/max markers** — render the lowest and highest points with a labeled dot showing their
  values, so the chart communicates its range at a glance.
- **Scrub label above the chart** — a label positioned above the graph shows the date +
  balance of the point under the cursor/finger while scrubbing. When not scrubbing, it shows
  the range (lowest → highest). Wired via recharts' active-tooltip / mouse-move state lifted
  to the parent label rather than rendered as an in-chart tooltip.

The component receives the `days` array (as today) plus the `lowest`/`highest` days so it can
mark them without re-deriving.

### 4. Daily card event ordering

Each day's `events` are sorted for display: **all income events first (largest amount to
smallest), then all expenses (largest magnitude to smallest)**. This is presentational —
sorted in `DailyCard` (or a tiny pure helper), leaving the engine's event order untouched.

## Testing

- **Engine:** Vitest test for `highest` in `lib/engine/forecast.test.ts` (mirrors `lowest`).
- **Event ordering:** if extracted to a pure helper, a small Vitest test covering income/
  expense partitioning and descending sort.
- **UI:** collapse-on-scroll, sticky bar, smaller widgets, and graph scrubbing/markers are
  verified against the running app (no Playwright in this slice, per project conventions).

## Files touched

- `lib/engine/forecast.ts`, `lib/engine/types.ts` — add `highest`.
- `lib/engine/forecast.test.ts` — test for `highest`.
- `app/page.tsx` — wire collapse state, pass `lowest`/`highest` to the graph.
- `app/_components/dashboard/BalanceSparkline.tsx` — markers + scrub label.
- `app/_components/dashboard/DailyCard.tsx` — event sort (+ optional helper/test).
- New `app/_components/dashboard/CollapsibleTopSection.tsx` — sticky/observer wiring.
