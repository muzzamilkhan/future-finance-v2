# Account Exhaustion Surfacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-account overdraft (exhaustion) on the dashboard so a transfer that overdraws its source account — invisible today because it nets to zero on the combined line — is flagged.

**Architecture:** The engine already computes `AccountDaily.isExhausted` per account per day but nothing consumes it. Add a day-level `hasExhaustedAccount` flag and a `ForecastResult.exhaustions` list (first exhaustion per account), then render those on the dashboard's renamed "Combined Shortfall" card and mark exhausted accounts on the day cards. Engine + client render only — no server, schema, or tRPC changes.

**Tech Stack:** TypeScript, Vitest, Next.js (App Router), React 19, Tailwind v4.

## Global Constraints

- Test runner is **Vitest** everywhere. No Playwright.
- Keep `lib/engine/` free of React/Prisma/Next imports.
- Currency formatting: NZD via the existing `formatCurrency` helper from `@/lib/design-system`.
- The **combined line** and its derived signals (`combined`, `firstNegative`, `lowest`, `highest`, `isNegative`) MUST keep their current meaning. Exhaustion is purely additive.
- Exhaustion applies to **both** DEBIT (balance < 0) and CREDIT (availableCredit < 0) accounts — the engine's existing `AccountDaily.isExhausted` already encodes both; do not re-derive it.
- Commit after each task.
- Dashboard already runs on the user's dev server; do not start a new one.

## File Structure

- `lib/engine/types.ts` — add `AccountExhaustion` interface, `DailyBalance.hasExhaustedAccount`, `ForecastResult.exhaustions`. (Note: `ForecastResult` is declared in `forecast.ts` and re-exported from `types.ts`; the field is added in `forecast.ts`, the `AccountExhaustion` type in `types.ts`.)
- `lib/engine/forecast.ts` — populate `hasExhaustedAccount` per day and build `exhaustions`.
- `lib/engine/forecast.test.ts` — engine tests (append to the multi-account section).
- `app/page.tsx` — rename metric to "Combined Shortfall", nest per-account lines, include exhaustion days in the daily-card filter.
- `app/_components/dashboard/DailyCard.tsx` — border + per-account marker when `hasExhaustedAccount`.

---

### Task 1: Engine — `AccountExhaustion` type and `hasExhaustedAccount` per day

**Files:**
- Modify: `lib/engine/types.ts`
- Modify: `lib/engine/forecast.ts`
- Test: `lib/engine/forecast.test.ts`

**Interfaces:**
- Consumes: existing `AccountDaily` (`{ accountId, type, balance, availableCredit, isExhausted }`), `DailyBalance`, `computeForecast`.
- Produces:
  - `AccountExhaustion` interface (in `types.ts`): `{ accountId: string; date: Date; balance: number; availableCredit: number | null; type: "DEBIT" | "CREDIT" }`.
  - `DailyBalance.hasExhaustedAccount: boolean`.
  - `ForecastResult.exhaustions: AccountExhaustion[]` — first exhaustion per account, ordered by `date` ascending.

- [ ] **Step 1: Write the failing tests**

Append to the multi-account section of `lib/engine/forecast.test.ts` (after the existing transfer/credit tests, before EOF). These reuse the existing `day`, `input`, `p`, `debit`, `credit` helpers already defined in that file.

```ts
it("nets a transfer to zero on the combined line yet flags the overdrawn source", () => {
  // debit has 1000; transfer 1200 out to credit. Combined stays flat, but debit -> -200.
  const r = computeForecast(input(
    [p({ id: "t", type: "TRANSFER", accountId: "debit", toAccountId: "credit", amount: 1200 })],
    [debit, credit],
  ));
  const jan5 = r.days.find(x => x.date.getUTCDate() === 5)!;
  // combined unchanged by a same-day transfer, so no combined-negative day:
  expect(r.firstNegative).toBeNull();
  // but the source account is exhausted that day:
  expect(jan5.hasExhaustedAccount).toBe(true);
  const ex = r.exhaustions.find(e => e.accountId === "debit")!;
  expect(ex).toBeDefined();
  expect(ex.date.getUTCDate()).toBe(5);
  expect(ex.balance).toBe(-200);
  expect(ex.type).toBe("DEBIT");
  expect(ex.availableCredit).toBeNull();
});

it("reports a credit account pushed past its limit as an exhaustion", () => {
  // credit anchor -200, limit 1000 => availableCredit 800. A 900 expense -> availableCredit -100.
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "credit", amount: 900 })], [debit, credit]));
  const ex = r.exhaustions.find(e => e.accountId === "credit")!;
  expect(ex).toBeDefined();
  expect(ex.type).toBe("CREDIT");
  expect(ex.availableCredit).toBe(-100);
});

it("records only the FIRST day an account is exhausted", () => {
  const r = computeForecast(input(
    [
      p({ id: "a", type: "EXPENSE", accountId: "debit", amount: 1200, startDate: day(0, 5) }),
      p({ id: "b", type: "EXPENSE", accountId: "debit", amount: 50, startDate: day(0, 9) }),
    ],
    [debit],
  ));
  const debitExhaustions = r.exhaustions.filter(e => e.accountId === "debit");
  expect(debitExhaustions).toHaveLength(1);
  expect(debitExhaustions[0]!.date.getUTCDate()).toBe(5);
});

it("returns no exhaustions and hasExhaustedAccount false when all accounts stay solvent", () => {
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "debit", amount: 100 })], [debit, credit]));
  expect(r.exhaustions).toEqual([]);
  expect(r.days.every(d => d.hasExhaustedAccount === false)).toBe(true);
});

it("orders exhaustions by date ascending across accounts", () => {
  // credit exhausted Jan 5, debit exhausted Jan 9.
  const r = computeForecast(input(
    [
      p({ id: "c", type: "EXPENSE", accountId: "credit", amount: 900, startDate: day(0, 5) }),
      p({ id: "d", type: "EXPENSE", accountId: "debit", amount: 1100, startDate: day(0, 9) }),
    ],
    [debit, credit],
  ));
  expect(r.exhaustions.map(e => e.accountId)).toEqual(["credit", "debit"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/forecast.test.ts`
Expected: FAIL — `hasExhaustedAccount` and `exhaustions` are undefined (TypeScript/assertion errors).

- [ ] **Step 3: Add the `AccountExhaustion` type and `hasExhaustedAccount` field in `types.ts`**

In `lib/engine/types.ts`, after the `AccountDaily` interface (ends line 43), add:

```ts
export interface AccountExhaustion {
  accountId: string;
  date: Date;                      // first day this account is exhausted
  balance: number;                 // that account's balance that day (negative for debit)
  availableCredit: number | null;  // creditLimit + balance for CREDIT; null for DEBIT
  type: "DEBIT" | "CREDIT";
}
```

In the `DailyBalance` interface (currently ends with `isNegative: boolean;` around line 84), add a field:

```ts
  hasExhaustedAccount: boolean; // true if any account snapshot this day is exhausted
```

- [ ] **Step 4: Populate `hasExhaustedAccount` and build `exhaustions` in `forecast.ts`**

In `lib/engine/forecast.ts`:

First, import the new type. The file imports engine types around lines 13–16; add `AccountExhaustion` to that import list:

```ts
import type {
  EngineParticular, EngineHoliday, EngineAccount, AccountDaily,
  DailyBalance, DailyEvent, MonthlySummary, AccountExhaustion,
} from "./types";
```

Add `exhaustions` to the `ForecastResult` interface (currently lines 28–34):

```ts
export interface ForecastResult {
  days: DailyBalance[];
  months: MonthlySummary[];
  firstNegative: DailyBalance | null;
  lowest: DailyBalance | null;
  highest: DailyBalance | null;
  exhaustions: AccountExhaustion[];
}
```

In the day-building loop, where the `days.push({ ... })` object is created (currently lines 155–163), add the derived flag from the closing snapshot:

```ts
      days.push({
        date: new Date(cursor),
        openingBalance: opening,
        closingBalance: combined,
        combined,
        accounts: closingSnap,
        events,
        isNegative: combined < 0,
        hasExhaustedAccount: closingSnap.some((s) => s.isExhausted),
      });
```

After the `while` loop, before the `return { ... }` (currently line 168), build the exhaustions list by scanning days in order and recording each account's first exhaustion:

```ts
  const firstExhaustionByAccount = new Map<string, AccountExhaustion>();
  for (const day of days) {
    for (const acct of day.accounts) {
      if (acct.isExhausted && !firstExhaustionByAccount.has(acct.accountId)) {
        firstExhaustionByAccount.set(acct.accountId, {
          accountId: acct.accountId,
          date: day.date,
          balance: acct.balance,
          availableCredit: acct.availableCredit,
          type: acct.type,
        });
      }
    }
  }
  const exhaustions = [...firstExhaustionByAccount.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
```

Add `exhaustions` to the returned object (currently lines 168–174):

```ts
  return {
    days,
    months: summarize(days),
    firstNegative: days.find((d) => d.isNegative) ?? null,
    lowest: days.length ? days.reduce((lo, c) => (c.combined < lo.combined ? c : lo)) : null,
    highest: days.length ? days.reduce((hi, c) => (c.combined > hi.combined ? c : hi)) : null,
    exhaustions,
  };
```

Note: `exhaustions` is built from `days`, which only contains display-window days (`cursor >= displayStart`), so exhaustions are scoped to the visible window — matching the spec.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/engine/forecast.test.ts`
Expected: PASS — all new tests green, and every pre-existing test in the file still passes.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/types.ts lib/engine/forecast.ts lib/engine/forecast.test.ts
git commit -m "feat(engine): report per-account exhaustions and hasExhaustedAccount

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Day card — mark days and accounts that are exhausted

**Files:**
- Modify: `app/_components/dashboard/DailyCard.tsx`

**Interfaces:**
- Consumes: `DailyBalance.hasExhaustedAccount` and `DailyBalance.accounts` (`AccountDaily[]`) from Task 1; existing `AccountBadge`, `formatCurrency`, `accountNames`, `accountIds` props.
- Produces: no new exported interface; visual change only.

This task has no unit test (it is a pure render change in a client component with no existing test file for `DailyCard`); it is verified manually in Task 4. Keep the change minimal and self-contained.

- [ ] **Step 1: Apply the danger border when an account is exhausted, even if combined ≥ 0**

In `app/_components/dashboard/DailyCard.tsx`, the root `<Card>` (line 11) currently reads:

```tsx
    <Card id={`day-${dateToInputValue(day.date)}`} className={day.isNegative ? "border-finance-expense" : undefined}>
```

Change the condition to also trigger on exhaustion:

```tsx
    <Card id={`day-${dateToInputValue(day.date)}`} className={day.isNegative || day.hasExhaustedAccount ? "border-finance-expense" : undefined}>
```

- [ ] **Step 2: Show which account is overdrawn, and by how much**

Still in `DailyCard.tsx`, immediately after the day header `<div className="flex items-center justify-between">…</div>` block (closes at line 18) and before the `{day.events.length > 0 && (` block (line 19), insert an exhausted-account list:

```tsx
        {day.hasExhaustedAccount && (
          <ul className="mt-1 space-y-0.5">
            {day.accounts.filter((a) => a.isExhausted).map((a) => (
              <li key={a.accountId} className="flex justify-between text-xs text-finance-expense">
                <span className="flex items-center gap-1">
                  <AccountBadge accountId={a.accountId} accountNames={accountNames} orderedIds={accountIds} className="px-1.5 py-0 text-[10px]" />
                  <span>overdrawn</span>
                </span>
                <span className="shrink-0">
                  {formatCurrency(a.type === "CREDIT" ? (a.availableCredit ?? 0) : a.balance)}
                </span>
              </li>
            ))}
          </ul>
        )}
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors. (`AccountDaily` already carries `isExhausted`, `availableCredit`, `balance`, `type`, `accountId`.)

- [ ] **Step 4: Commit**

```bash
git add app/_components/dashboard/DailyCard.tsx
git commit -m "feat(dashboard): mark overdrawn accounts on day cards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard — "Combined Shortfall" card with per-account exhaustion lines

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `result.exhaustions: AccountExhaustion[]` and `result.firstNegative` from Task 1; existing `scrollToDay(date)`, `MetricCard` (with `footer` prop, as used by "Current Balance"), `AccountBadge`, `accountNames`, `accountIds`, `formatCurrency`, `formatUtcWeekdayMonthDay`.
- Produces: no new exported interface; dashboard render change only.

No unit test (client render); verified manually in Task 4.

- [ ] **Step 1: Rename the metric to "Combined Shortfall" and nest per-account lines**

In `app/page.tsx`, the "Next Negative" `MetricCard` (currently lines 147–149) reads:

```tsx
            <MetricCard title="Next Negative" value={result.firstNegative?.closingBalance ?? 0} type="warning"
              subtitle={result.firstNegative ? formatUtcWeekdayMonthDay(result.firstNegative.date) : undefined}
              onClick={result.firstNegative ? () => scrollToDay(result.firstNegative!.date) : undefined} />
```

Replace it with a renamed card that carries a `footer` listing exhausted accounts (mirroring how the "Current Balance" card at lines 134–142 uses `footer`):

```tsx
            <MetricCard title="Combined Shortfall" value={result.firstNegative?.closingBalance ?? 0} type="warning"
              subtitle={result.firstNegative ? formatUtcWeekdayMonthDay(result.firstNegative.date) : undefined}
              onClick={result.firstNegative ? () => scrollToDay(result.firstNegative!.date) : undefined}
              footer={
                result.exhaustions.length > 0 ? (
                  <ul className="space-y-1">
                    {result.exhaustions.map((ex) => (
                      <li key={ex.accountId}>
                        <button
                          type="button"
                          onClick={() => scrollToDay(ex.date)}
                          className="flex w-full items-center justify-between gap-1 text-left text-xs"
                        >
                          <span className="flex items-center gap-1">
                            <AccountBadge accountId={ex.accountId} accountNames={accountNames} orderedIds={accountIds} className="px-1.5 py-0 text-[10px]" />
                            <span className="text-muted-foreground">{formatUtcWeekdayMonthDay(ex.date)}</span>
                          </span>
                          <span className="shrink-0 text-finance-expense">
                            {formatCurrency(ex.type === "CREDIT" ? (ex.availableCredit ?? 0) : ex.balance)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : undefined
              } />
```

- [ ] **Step 2: Include exhaustion days in the daily-card filter**

In `app/page.tsx`, the daily-card filter (currently lines 162–167) reads:

```tsx
          {result.days
            .filter((day) =>
              day.events.length > 0 ||
              (result.lowest && isSameDay(day.date, result.lowest.date)) ||
              (result.firstNegative && isSameDay(day.date, result.firstNegative.date)),
            )
```

Add a clause so days whose only notable feature is an exhausted account are not filtered out:

```tsx
          {result.days
            .filter((day) =>
              day.events.length > 0 ||
              day.hasExhaustedAccount ||
              (result.lowest && isSameDay(day.date, result.lowest.date)) ||
              (result.firstNegative && isSameDay(day.date, result.firstNegative.date)),
            )
```

- [ ] **Step 3: Verify AccountBadge is imported in `app/page.tsx`**

Run: `grep -n "AccountBadge" app/page.tsx`
Expected: an existing import line for `AccountBadge`. If none is present, add it near the other dashboard-component imports:

```tsx
import { AccountBadge } from "@/app/_components/dashboard/AccountBadge";
```

(Match the import path/style already used for `DailyCard` in the same file.)

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat(dashboard): rename Next Negative to Combined Shortfall with per-account overdraft lines

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full engine test suite**

Run: `npx vitest run`
Expected: PASS — all suites, including the pre-existing forecast/combined tests.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual UI check on the running dev server**

On the dashboard (dev server already running per project convention — do not start a new one), with two owned accounts, add a TRANSFER whose amount exceeds the source account's balance at the transfer date. Confirm:
- The "Combined Shortfall" card shows a per-account line for the overdrawn account with its negative balance and date.
- Clicking that line scrolls to the correct day card.
- That day card has the red border and shows the overdrawn account badge with its negative amount, even though the combined balance is unchanged.

- [ ] **Step 4: Final commit if any verification fixups were needed**

Only if Steps 1–3 required changes:

```bash
git add -A
git commit -m "fix: address exhaustion-surfacing verification findings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §1 Engine (`hasExhaustedAccount`, `exhaustions`, DEBIT+CREDIT, first-only, ordered, exhaustive tests) → Task 1. ✓
- §2 Dashboard (rename to "Combined Shortfall", nested per-account lines via footer, exhausted-only, clickable → scrollToDay) → Task 3. ✓
- §3 Day card (border on exhaustion, per-account marker in expense color, include exhaustion days in filter) → Task 2 (card) + Task 3 Step 2 (filter). ✓
- Combined-line semantics unchanged → no task touches `combined`/`firstNegative`/`lowest`/`highest`/`isNegative` computation. ✓
- No server/schema/tRPC changes → confirmed; only `lib/engine/*` and `app/*` render. ✓

**Type consistency:** `AccountExhaustion` fields (`accountId`, `date`, `balance`, `availableCredit`, `type`) are defined in Task 1 and consumed identically in Tasks 2 (via `AccountDaily`) and 3. `hasExhaustedAccount` named consistently across types, engine, day card, and filter.

**Placeholders:** none — every code step shows complete code and exact commands.
