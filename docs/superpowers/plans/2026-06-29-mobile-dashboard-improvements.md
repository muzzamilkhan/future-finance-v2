# Mobile Dashboard Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile dashboard's top section compact and collapse-on-scroll, give the balance graph min/max markers and a scrub label, and order daily-card events income-then-expenses.

**Architecture:** One small engine addition (`highest`, mirroring `lowest`), then presentational changes in `app/page.tsx` and three dashboard components. Collapse/sticky wiring is isolated in a new `CollapsibleTopSection` client component so `page.tsx` stays readable. Event ordering is a pure helper so it can be unit-tested.

**Tech Stack:** Next.js 16 (App Router), React 19, Vitest, recharts, Tailwind v4, date-fns.

## Global Constraints

- Test runner is **Vitest** everywhere. No Playwright in this slice.
- Keep `lib/engine/` free of React/Prisma/Next imports.
- Currency formatting via `formatCurrency` from `@/lib/design-system` (NZD).
- `Particular.amount` is stored positive; engine event `amount` is already signed — do not re-sign.
- Commit frequently — one commit per completed task.
- All collapse/sticky/compact behavior is gated to mobile (`< sm`); desktop layout is unchanged.

---

### Task 1: Add `highest` to the forecast engine

**Files:**
- Modify: `lib/engine/forecast.ts:18-23` (`ForecastResult`) and `:88-95` (return object)
- Test: `lib/engine/forecast.test.ts`

**Interfaces:**
- Produces: `ForecastResult.highest: DailyBalance | null` — the day with the maximum `closingBalance`, or `null` when there are no days. Mirrors existing `lowest`.

- [ ] **Step 1: Write the failing test**

Add to `lib/engine/forecast.test.ts`, after the "reports the lowest balance day" test (line ~54):

```ts
  it("reports the highest balance day", () => {
    const income = (id: string, day: string, amt: number): EngineParticular => ({
      id, name: id, type: "INCOME", amount: amt, frequency: "ONCE_OFF",
      startDate: d(day), endDate: null, isCritical: true, isFixed: true,
      businessDayAdjustment: "NONE", overrides: [],
    });
    const r = computeForecast(baseInput({
      particulars: [income("a", "2026-07-02", 300), income("b", "2026-07-03", 100)],
    }));
    // Jul 2 closes at 1300, Jul 3 at 1400 — Jul 3 is highest
    expect(r.highest!.date.getDate()).toBe(3);
    expect(r.highest!.closingBalance).toBe(1400);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/forecast.test.ts -t "highest"`
Expected: FAIL — `r.highest` is `undefined`, so `r.highest!.date` throws.

- [ ] **Step 3: Add `highest` to the type**

In `lib/engine/forecast.ts`, edit `ForecastResult`:

```ts
export interface ForecastResult {
  days: DailyBalance[];
  months: MonthlySummary[];
  firstNegative: DailyBalance | null;
  lowest: DailyBalance | null;
  highest: DailyBalance | null;
}
```

- [ ] **Step 4: Compute `highest` in the return object**

In the `return { ... }` near line 88, add after `lowest`:

```ts
    lowest: days.length
      ? days.reduce((lo, c) => (c.closingBalance < lo.closingBalance ? c : lo))
      : null,
    highest: days.length
      ? days.reduce((hi, c) => (c.closingBalance > hi.closingBalance ? c : hi))
      : null,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/engine/forecast.test.ts`
Expected: PASS (all tests, including the new "highest" one).

- [ ] **Step 6: Commit**

```bash
git add lib/engine/forecast.ts lib/engine/forecast.test.ts
git commit -m "feat(engine): add highest balance day to forecast result"
```

---

### Task 2: Daily-card event ordering helper

**Files:**
- Create: `app/_components/dashboard/sortEvents.ts`
- Test: `app/_components/dashboard/sortEvents.test.ts`
- Modify: `app/_components/dashboard/DailyCard.tsx:16-18`

**Interfaces:**
- Consumes: `DailyEvent` from `@/lib/engine` (has `kind: "income" | "expense"` and signed `amount: number`).
- Produces: `sortDailyEvents(events: DailyEvent[]): DailyEvent[]` — returns a new array, income events first then expense events, each group sorted by `amount` descending (largest magnitude first within a group). Does not mutate the input.

- [ ] **Step 1: Write the failing test**

Create `app/_components/dashboard/sortEvents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sortDailyEvents } from "./sortEvents";
import type { DailyEvent } from "@/lib/engine";

const ev = (name: string, kind: "income" | "expense", amount: number): DailyEvent => ({
  particularId: name, name, amount, kind,
  isOverridden: false, isSkipped: false, isMovedDueToHoliday: false,
});

describe("sortDailyEvents", () => {
  it("puts income before expenses, each descending by amount", () => {
    const input = [
      ev("small-exp", "expense", -50),
      ev("big-inc", "income", 900),
      ev("big-exp", "expense", -400),
      ev("small-inc", "income", 100),
    ];
    const out = sortDailyEvents(input).map((e) => e.name);
    // income desc: 900, 100; then expenses desc by signed amount: -50, -400
    expect(out).toEqual(["big-inc", "small-inc", "small-exp", "big-exp"]);
  });

  it("does not mutate the input array", () => {
    const input = [ev("b", "income", 1), ev("a", "income", 2)];
    const copy = [...input];
    sortDailyEvents(input);
    expect(input).toEqual(copy);
  });
});
```

Note: expenses have negative `amount`, so descending by signed `amount` yields largest-magnitude expense last. The product intent is "expenses by amount descending"; sorting the signed value descending means `-50` before `-400`. This matches "amount descending" on the displayed signed figure and keeps the rule a single comparator.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/_components/dashboard/sortEvents.test.ts`
Expected: FAIL — module `./sortEvents` not found.

- [ ] **Step 3: Implement the helper**

Create `app/_components/dashboard/sortEvents.ts`:

```ts
import type { DailyEvent } from "@/lib/engine";

/** Income events first then expenses; each group sorted by signed amount descending. */
export function sortDailyEvents(events: DailyEvent[]): DailyEvent[] {
  const rank = (e: DailyEvent) => (e.kind === "income" ? 0 : 1);
  return [...events].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return b.amount - a.amount;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/_components/dashboard/sortEvents.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helper in DailyCard**

In `app/_components/dashboard/DailyCard.tsx`, add the import at the top:

```ts
import { sortDailyEvents } from "./sortEvents";
```

Then change the events map to sort first. Replace:

```tsx
            {day.events.map((e, i) => (
```

with:

```tsx
            {sortDailyEvents(day.events).map((e, i) => (
```

- [ ] **Step 6: Run the engine + helper tests and typecheck**

Run: `npx vitest run app/_components/dashboard/sortEvents.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add app/_components/dashboard/sortEvents.ts app/_components/dashboard/sortEvents.test.ts app/_components/dashboard/DailyCard.tsx
git commit -m "feat(dashboard): order daily-card events income then expenses, amount desc"
```

---

### Task 3: Graph with min/max markers and scrub label

**Files:**
- Modify: `app/_components/dashboard/BalanceSparkline.tsx` (full rewrite of the component)
- Modify: `app/page.tsx:86` (pass `lowest`/`highest`)

**Interfaces:**
- Consumes: `ForecastResult.lowest` and `ForecastResult.highest` (Task 1), `DailyBalance[]`.
- Produces: `BalanceSparkline` props become `{ days: DailyBalance[]; lowest: DailyBalance | null; highest: DailyBalance | null }`.

- [ ] **Step 1: Rewrite BalanceSparkline**

Replace the entire contents of `app/_components/dashboard/BalanceSparkline.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { DailyBalance } from "@/lib/engine";
import { formatCurrency } from "@/lib/design-system";
import { format, isSameDay } from "date-fns";
import {
  LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, ReferenceDot,
} from "recharts";

type Point = { date: Date; v: number };

export function BalanceSparkline({
  days, lowest, highest,
}: {
  days: DailyBalance[];
  lowest: DailyBalance | null;
  highest: DailyBalance | null;
}) {
  const data: Point[] = days.map((d) => ({ date: d.date, v: d.closingBalance }));
  const [active, setActive] = useState<Point | null>(null);

  const label = active
    ? `${format(active.date, "EEE, MMM d")} · ${formatCurrency(active.v)}`
    : lowest && highest
      ? `Low ${formatCurrency(lowest.closingBalance)} · High ${formatCurrency(highest.closingBalance)}`
      : "";

  const indexOf = (d: DailyBalance | null) =>
    d ? data.findIndex((p) => isSameDay(p.date, d.date)) : -1;
  const lowIdx = indexOf(lowest);
  const highIdx = indexOf(highest);

  return (
    <div>
      <div className="mb-1 h-5 text-xs text-muted-foreground tabular-nums">{label}</div>
      <ResponsiveContainer width="100%" height={64}>
        <LineChart
          data={data}
          onMouseMove={(s) => {
            const p = s?.activePayload?.[0]?.payload as Point | undefined;
            if (p) setActive(p);
          }}
          onMouseLeave={() => setActive(null)}
        >
          <XAxis dataKey="date" hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip content={() => null} cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }} />
          <Line type="monotone" dataKey="v" dot={false} strokeWidth={2} stroke="currentColor" isAnimationActive={false} />
          {lowIdx >= 0 && (
            <ReferenceDot x={lowIdx} y={data[lowIdx]!.v} r={3}
              className="fill-finance-expense" stroke="none" />
          )}
          {highIdx >= 0 && (
            <ReferenceDot x={highIdx} y={data[highIdx]!.v} r={3}
              className="fill-finance-income" stroke="none" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Note: `ReferenceDot` `x` must match the X domain. Because `XAxis` uses `dataKey="date"` (category axis), `x` should be the category value. Use the date value, not the index — see Step 2's correction if dots are misplaced.

- [ ] **Step 2: Correct ReferenceDot x to the category value**

`XAxis dataKey="date"` makes the axis categorical over `Date` objects. `ReferenceDot x` must equal a category value (the same `Date` reference used in `data`). Update both `ReferenceDot`s to pass the date and the value directly:

```tsx
          {lowest && lowIdx >= 0 && (
            <ReferenceDot x={data[lowIdx]!.date as unknown as number} y={data[lowIdx]!.v} r={3}
              className="fill-finance-expense" stroke="none" />
          )}
          {highest && highIdx >= 0 && (
            <ReferenceDot x={data[highIdx]!.date as unknown as number} y={data[highIdx]!.v} r={3}
              className="fill-finance-income" stroke="none" />
          )}
```

- [ ] **Step 3: Update the call site in page.tsx**

In `app/page.tsx`, replace line 86:

```tsx
        <div className="text-foreground"><BalanceSparkline days={result.days} /></div>
```

with:

```tsx
        <div className="text-foreground">
          <BalanceSparkline days={result.days} lowest={result.lowest} highest={result.highest} />
        </div>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify in the running app**

Open the dashboard on a narrow viewport. Confirm: the line chart shows a red dot at the lowest point and a green dot at the highest; the label above reads "Low … · High …" at rest; scrubbing across the chart updates the label to the hovered day + balance; leaving the chart restores the range label. If the dots are misplaced, the X mapping is wrong — fall back to `XAxis` with no `dataKey` (numeric index axis) and `ReferenceDot x={lowIdx}`.

- [ ] **Step 6: Commit**

```bash
git add app/_components/dashboard/BalanceSparkline.tsx app/page.tsx
git commit -m "feat(dashboard): graph min/max markers and scrub label"
```

---

### Task 4: Collapsible sticky top section (mobile)

**Files:**
- Create: `app/_components/dashboard/CollapsibleTopSection.tsx`
- Modify: `app/page.tsx` (wrap widgets + graph; add compact-bar content)

**Interfaces:**
- Consumes: nothing from earlier tasks beyond rendered children.
- Produces: `CollapsibleTopSection` — a client component that renders its `children` (the widgets + graph) in a collapsible region on mobile, auto-collapses when a sentinel scrolls out of view, and shows a tappable sticky compact bar (`compact` prop) when collapsed. On desktop (`sm:` and up) it always renders children expanded with no sticky bar.

```ts
type CollapsibleTopSectionProps = {
  children: React.ReactNode;
  compact: React.ReactNode; // shown in the sticky bar when collapsed (mobile only)
};
```

- [ ] **Step 1: Create the component**

Create `app/_components/dashboard/CollapsibleTopSection.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

export function CollapsibleTopSection({
  children, compact,
}: {
  children: React.ReactNode;
  compact: React.ReactNode;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry!.isIntersecting && entry!.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      {/* Sticky compact bar — mobile only, only when collapsed */}
      <div
        className={`sticky top-0 z-20 -mx-4 border-b bg-background px-4 py-2 sm:hidden ${
          collapsed ? "block" : "hidden"
        }`}
        onClick={() => setCollapsed(false)}
        role="button"
        tabIndex={0}
      >
        {compact}
      </div>

      {/* Full top section — collapses on mobile, always shown on desktop */}
      <div className={collapsed ? "hidden sm:block" : "block"}>{children}</div>

      {/* Sentinel just below the top section */}
      <div ref={sentinelRef} aria-hidden className="h-0" />
    </>
  );
}
```

- [ ] **Step 2: Wrap the widgets + graph in page.tsx**

In `app/page.tsx`, add the import:

```tsx
import { CollapsibleTopSection } from "@/app/_components/dashboard/CollapsibleTopSection";
```

Wrap the metric grid (lines 71-84) and the graph block together. Replace the grid `<div>` and the graph `<div>` with:

```tsx
        <CollapsibleTopSection
          compact={
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{formatCurrency(current)}</span>
              {result.lowest && (
                <span className="text-muted-foreground">
                  Low {formatCurrency(result.lowest.closingBalance)} · {format(result.lowest.date, "MMM d")}
                </span>
              )}
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <MetricCard title="Current Balance" value={current} type={current >= 0 ? "income" : "expense"}
              editable onSave={(balance) => updateBalance.mutate({ balance })} />
            <MetricCard title="Lowest Balance" value={result.lowest?.closingBalance ?? 0}
              type={(result.lowest?.closingBalance ?? 0) >= 0 ? "income" : "expense"}
              subtitle={result.lowest ? format(result.lowest.date, "EEE, MMM d") : undefined}
              onClick={result.lowest ? () => scrollToDay(result.lowest!.date) : undefined} />
            <MetricCard title="Next Negative" value={result.firstNegative?.closingBalance ?? 0} type="warning"
              subtitle={result.firstNegative ? format(result.firstNegative.date, "EEE, MMM d") : undefined}
              onClick={result.firstNegative ? () => scrollToDay(result.firstNegative!.date) : undefined} />
            <MetricCard title="This Month" value={thisMonth?.netChange ?? 0}
              subtitle={`${formatCurrency(thisMonth?.totalIncome ?? 0)} in, ${formatCurrency(thisMonth?.totalExpenses ?? 0)} out`}
              type={(thisMonth?.netChange ?? 0) >= 0 ? "income" : "expense"} />
          </div>

          <div className="mt-4 text-foreground">
            <BalanceSparkline days={result.days} lowest={result.lowest} highest={result.highest} />
          </div>
        </CollapsibleTopSection>
```

Note: the grid is now `grid-cols-2` on mobile (smaller widgets, two per row) and `lg:grid-cols-4` on desktop. The gap tightens on mobile (`gap-2`).

- [ ] **Step 3: Shrink the MetricCard on mobile**

In `app/_components/dashboard/MetricCard.tsx`, shrink the header and value on mobile only.

Change the `CardHeader` line (line 37) from `className="pb-2"` to `className="pb-1 sm:pb-2"`:

```tsx
      <CardHeader className="pb-1 sm:pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
```

Change the value `<div>` (line 61) from `text-2xl` to `text-xl sm:text-2xl`:

```tsx
            <div className={`text-xl font-bold sm:text-2xl ${color}`}>{formatCurrency(value)}</div>
```

Apply the responsive prefix only — do not remove the desktop class.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify in the running app**

On a narrow viewport: widgets are two-per-row and visibly smaller; scrolling down past the widgets collapses the top section and pins a slim bar showing current balance + lowest; tapping the bar expands the full section; on a wide viewport the full 4-up grid is always shown and no sticky bar appears.

- [ ] **Step 6: Commit**

```bash
git add app/_components/dashboard/CollapsibleTopSection.tsx app/_components/dashboard/MetricCard.tsx app/page.tsx
git commit -m "feat(dashboard): collapsible sticky top section with smaller mobile widgets"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (engine `highest`, `sortDailyEvents`, and the rest).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no type errors. (There is no `lint` script in this repo; typecheck is the gate.)

- [ ] **Step 3: Manual mobile smoke test**

On a narrow viewport confirm all four goals together: smaller collapsible widgets, auto-collapse + sticky bar on scroll, graph min/max markers + scrub label, and daily cards listing income before expenses. Confirm desktop is unchanged.

- [ ] **Step 4: Commit any final fixes**

If verification surfaced fixes, commit them with a descriptive message. Otherwise this task produces no commit.

---

## Self-Review Notes

- **Spec coverage:** smaller+collapsible top section (Task 4), auto-collapse + sticky bar (Task 4), graph low/high values (Tasks 1+3), scrub label (Task 3), daily-card ordering (Task 2). All four spec goals covered.
- **Type consistency:** `highest` added in Task 1 and consumed in Tasks 3/4; `sortDailyEvents` signature consistent between Task 2 definition and use; `BalanceSparkline` props consistent between Task 3 definition and Task 4 call site.
- **No placeholders:** every code step has full code.
