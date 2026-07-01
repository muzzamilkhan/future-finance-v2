# Lowest Balance — Per-Account Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-account lowest-balance breakdown to the dashboard's "Lowest Balance" card, mirroring the "Current Balance" card's per-account footer.

**Architecture:** The engine (`lib/engine/forecast.ts`) computes a new `lowestByAccount: AccountLow[]` array by scanning existing `days[*].accounts` snapshots for each account's minimum *display figure* (available credit for CREDIT, balance for DEBIT). A new read-only `AccountLowList` component renders this in the "Lowest Balance" `MetricCard` footer, gated on >1 account, with each row clickable to scroll to that account's low day.

**Tech Stack:** TypeScript, Vitest, React 19, Next.js 16 (App Router), Tailwind v4.

## Global Constraints

- `lib/engine/` must stay free of React/Prisma/Next imports.
- Engine is deterministic: no clock reads; all dates derive from inputs.
- Currency formatting via existing `formatCurrency` (`@/lib/design-system`), NZD.
- Tie-breaks pick the **earliest** day, consistent with `exhaustions`.
- Test runner is Vitest. Commit one task per commit.

---

### Task 1: Engine — `AccountLow` type and `lowestByAccount` computation

**Files:**
- Modify: `lib/engine/types.ts` (add `AccountLow` interface after `AccountExhaustion`, ~line 51)
- Modify: `lib/engine/forecast.ts` (add `lowestByAccount` to `ForecastResult` interface ~line 34; compute and return it ~line 188)
- Test: `lib/engine/forecast.test.ts` (append new tests)

**Interfaces:**
- Consumes: existing `DailyBalance.accounts: AccountDaily[]` where `AccountDaily = { accountId; type: "DEBIT"|"CREDIT"; balance; availableCredit: number|null; isExhausted }`.
- Produces: `AccountLow { accountId: string; type: "DEBIT"|"CREDIT"; date: Date; balance: number; availableCredit: number|null }` and `ForecastResult.lowestByAccount: AccountLow[]`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/engine/forecast.test.ts` (helpers `day`, `input`, `debit`, `credit`, `p` already exist in this file):

```ts
describe("lowestByAccount", () => {
  it("is empty when there are no days", () => {
    const r = computeForecast({ ...input([], [debit]), viewStart: day(0, 31), viewEnd: day(0, 1) });
    expect(r.lowestByAccount).toEqual([]);
  });

  it("has one entry for a single account", () => {
    const r = computeForecast(input([], [debit]));
    expect(r.lowestByAccount).toHaveLength(1);
    expect(r.lowestByAccount[0]!.accountId).toBe("debit");
  });

  it("tracks each debit account's own lowest by balance and date", () => {
    // debit dips to 900 on the 5th (100 expense)
    const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "debit", amount: 100 })], [debit]));
    const low = r.lowestByAccount.find((a) => a.accountId === "debit")!;
    expect(low.balance).toBe(900);
    expect(low.date.getUTCDate()).toBe(31); // stays at 900 through end; earliest min is the 5th
  });

  it("uses available credit as the low figure for CREDIT accounts", () => {
    // credit expense on the 5th: available drops 800 -> 700 and stays
    const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "credit", amount: 100 })], [debit, credit]));
    const low = r.lowestByAccount.find((a) => a.accountId === "credit")!;
    expect(low.availableCredit).toBe(700);
    expect(low.date.getUTCDate()).toBe(5); // first day it reaches 700
  });

  it("picks the earliest day on a tie", () => {
    // two equal 100 expenses on the 5th and the 10th; account sits at 800 from the 10th
    // but first reaches its running min (900) on the 5th
    const r = computeForecast(input(
      [
        p({ id: "e1", type: "EXPENSE", accountId: "debit", amount: 100, startDate: day(0, 5) }),
        p({ id: "e2", type: "EXPENSE", accountId: "debit", amount: 0, startDate: day(0, 10) }),
      ],
      [debit],
    ));
    const low = r.lowestByAccount.find((a) => a.accountId === "debit")!;
    expect(low.balance).toBe(900);
    expect(low.date.getUTCDate()).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/forecast.test.ts -t lowestByAccount`
Expected: FAIL — `lowestByAccount` is `undefined` on the result.

- [ ] **Step 3: Add the `AccountLow` type**

In `lib/engine/types.ts`, after the `AccountExhaustion` interface (ends ~line 51):

```ts
export interface AccountLow {
  accountId: string;
  type: "DEBIT" | "CREDIT";
  date: Date;                     // the day this account hit its lowest
  balance: number;                // DEBIT cash at that point
  availableCredit: number | null; // CREDIT available credit at that point; null for DEBIT
}
```

- [ ] **Step 4: Extend `ForecastResult` and import the type**

In `lib/engine/forecast.ts`, add `AccountLow` to the type import block (~line 13-16):

```ts
import type {
  EngineParticular, EngineHoliday, EngineAccount, AccountDaily,
  DailyBalance, DailyEvent, MonthlySummary, AccountExhaustion, AccountLow,
} from "./types";
```

Add the field to `ForecastResult` (~line 34, after `exhaustions`):

```ts
  exhaustions: AccountExhaustion[];
  lowestByAccount: AccountLow[];
```

- [ ] **Step 5: Compute `lowestByAccount` and return it**

In `lib/engine/forecast.ts`, immediately before the `return {` (~line 188, after `exhaustions` is built), add:

```ts
  // Per-account lowest point, measured on the DISPLAY figure the UI renders:
  // available credit for CREDIT, cash balance for DEBIT. Earliest day wins ties.
  const lowestByAccount = new Map<string, AccountLow>();
  const figure = (a: AccountDaily) => (a.type === "CREDIT" ? a.availableCredit ?? 0 : a.balance);
  for (const day of days) {
    for (const acct of day.accounts) {
      const prev = lowestByAccount.get(acct.accountId);
      if (!prev || figure(acct) < figure({ type: prev.type, balance: prev.balance, availableCredit: prev.availableCredit } as AccountDaily)) {
        lowestByAccount.set(acct.accountId, {
          accountId: acct.accountId,
          type: acct.type,
          date: day.date,
          balance: acct.balance,
          availableCredit: acct.availableCredit,
        });
      }
    }
  }
```

Then add to the returned object (after `exhaustions,`):

```ts
    exhaustions,
    lowestByAccount: [...lowestByAccount.values()],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run lib/engine/forecast.test.ts -t lowestByAccount`
Expected: PASS (5 tests).

- [ ] **Step 7: Run the full engine suite (no regressions)**

Run: `npx vitest run lib/engine`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/engine/types.ts lib/engine/forecast.ts lib/engine/forecast.test.ts
git commit -m "feat(engine): per-account lowest balance in forecast result

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: UI — `AccountLowList` component

**Files:**
- Create: `app/_components/dashboard/AccountLowList.tsx`
- Reference (do not modify): `app/_components/dashboard/AccountBalanceList.tsx` (layout source), `app/_components/AccountContext.tsx` (`AccountListItem` type)

**Interfaces:**
- Consumes: `AccountLow[]` from Task 1; `AccountListItem[]` (has `id`, `name`, `type`, `currentBalance`, `creditLimit`) from `AccountContext`.
- Produces: `AccountLowList({ accounts, lows, onSelect })` where `onSelect: (date: Date) => void`. Returns `null` when `accounts.length <= 1`.

- [ ] **Step 1: Create the component**

Create `app/_components/dashboard/AccountLowList.tsx`:

```tsx
"use client";

import { formatCurrency } from "@/lib/design-system";
import { formatUtcMonthDay } from "@/lib/dateInput";
import type { AccountLow } from "@/lib/engine/types";
import type { AccountListItem } from "@/app/_components/AccountContext";

/**
 * Read-only per-account lowest-balance lines inside the "Lowest Balance" card,
 * mirroring AccountBalanceList's layout. Each row shows the account's own low
 * (available credit for CREDIT, cash for DEBIT) and the date it occurs; clicking
 * scrolls to that day. Hidden for single-account users.
 */
export function AccountLowList(
  { accounts, lows, onSelect }:
  { accounts: AccountListItem[]; lows: AccountLow[]; onSelect: (date: Date) => void },
) {
  if (accounts.length <= 1) return null;
  const byId = new Map(lows.map((l) => [l.accountId, l]));
  return (
    <div className="mt-3 space-y-1 border-t pt-2">
      {accounts.map((a) => {
        const low = byId.get(a.id);
        if (!low) return null;
        const isCredit = a.type === "CREDIT";
        const figure = isCredit ? low.availableCredit ?? 0 : low.balance;
        const label = isCredit ? `${a.name} (available)` : a.name;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(low.date)}
            className="flex w-full items-center justify-between gap-2 text-sm cursor-pointer hover:opacity-80"
          >
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{label}</span>
            <span className="shrink-0 text-muted-foreground">{formatUtcMonthDay(low.date)}</span>
            <span className={figure < 0 ? "text-finance-expense" : "text-foreground"}>
              {formatCurrency(figure)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify imports resolve**

Confirm `formatUtcMonthDay` is exported from `@/lib/dateInput` and `AccountListItem` from `@/app/_components/AccountContext` (both are already imported elsewhere in `app/page.tsx`).

Run: `npx tsc --noEmit`
Expected: no new errors from `AccountLowList.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/_components/dashboard/AccountLowList.tsx
git commit -m "feat(dashboard): AccountLowList per-account lowest component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: UI — wire `AccountLowList` into the Lowest Balance card

**Files:**
- Modify: `app/page.tsx` (add import ~top; add `footer` to the "Lowest Balance" `MetricCard`, ~line 144-147)

**Interfaces:**
- Consumes: `AccountLowList` (Task 2), `result.lowestByAccount` (Task 1), existing `accounts` and `scrollToDay` in `app/page.tsx`.

- [ ] **Step 1: Add the import**

In `app/page.tsx`, alongside the other dashboard component imports (near the `AccountBalanceList` import):

```tsx
import { AccountLowList } from "@/app/_components/dashboard/AccountLowList";
```

- [ ] **Step 2: Add the footer to the Lowest Balance MetricCard**

In `app/page.tsx`, extend the existing "Lowest Balance" `MetricCard` (~line 144-147) with a `footer` prop:

```tsx
            <MetricCard title="Lowest Balance" value={result.lowest?.closingBalance ?? 0}
              type={(result.lowest?.closingBalance ?? 0) >= 0 ? "income" : "expense"}
              subtitle={result.lowest ? formatUtcWeekdayMonthDay(result.lowest.date) : undefined}
              onClick={result.lowest ? () => scrollToDay(result.lowest!.date) : undefined}
              footer={
                <AccountLowList
                  accounts={accounts}
                  lows={result.lowestByAccount}
                  onSelect={(date) => scrollToDay(date)}
                />
              } />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Verify the full test suite passes**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Manual check (dev server already running on :3000)**

Load the dashboard with a multi-account user; confirm the "Lowest Balance" card shows a per-account footer with dates, and clicking a row scrolls to that day. Single-account users see no footer. (See `dev.log` if debugging.)

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat(dashboard): show per-account lowest in Lowest Balance card

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** engine `AccountLow` + `lowestByAccount` (Task 1); read-only `AccountLowList` with credit-available figure, date, `>1` gating (Task 2); footer wiring into existing card, headline unchanged (Task 3). Tie-break (earliest), CREDIT figure, single-account, and empty-days cases all covered by Task 1 tests.
- **Type consistency:** `AccountLow` fields (`accountId`, `type`, `date`, `balance`, `availableCredit`) are identical across type def, engine computation, and component consumption. `onSelect: (date: Date) => void` matches `scrollToDay`'s signature.
- **No placeholders:** all steps carry concrete code and exact commands.
