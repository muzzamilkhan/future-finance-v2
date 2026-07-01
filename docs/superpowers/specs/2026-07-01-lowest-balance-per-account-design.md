# Lowest Balance — Per-Account Breakdown

**Date:** 2026-07-01
**Status:** Approved

## Problem

The dashboard's "Lowest Balance" card shows a single *combined* lowest point
across all accounts. With multiple accounts, users can't see which account
drives the low or when each account individually bottoms out. The "Current
Balance" card already solves the analogous problem with a per-account footer
list (`AccountBalanceList`).

## Goal

Add a per-account breakdown to the "Lowest Balance" card, mirroring the
"Current Balance" card layout:

- Headline stays the **combined** lowest (`result.lowest.closingBalance`).
- Footer lists **each account's own lowest point**: name, lowest figure, and
  the date it occurs. Clicking a row scrolls to that day.
- Footer appears only when there is more than one account (matches
  `AccountBalanceList`, which returns `null` for `accounts.length <= 1`).

## Engine

The per-account lowest is computed in the engine (`lib/engine/`), consistent
with the architecture invariant that the engine is the testable, deterministic
heart.

### New type (`lib/engine/types.ts`)

```ts
export interface AccountLow {
  accountId: string;
  type: "DEBIT" | "CREDIT";
  date: Date;                     // the day this account hit its lowest
  balance: number;                // DEBIT cash at that point
  availableCredit: number | null; // CREDIT available credit at that point; null for DEBIT
}
```

### `ForecastResult` addition (`lib/engine/forecast.ts`)

```ts
lowestByAccount: AccountLow[];  // one entry per account present in `days`
```

### Computation

Iterate `days`; for each account snapshot (`day.accounts`), track the minimum of
the **display figure** — `availableCredit` for CREDIT, `balance` for DEBIT. This
matches exactly what the row renders and what the Current Balance list uses.

- **Tie-break:** on equal figures, keep the **earliest** day (first occurrence),
  consistent with how `exhaustions` picks the first exhaustion day.
- **Ordering:** entries follow the account order as seen in `days[*].accounts`
  (the same order badges and the balance list use).
- Empty when `days` is empty. For a single account, the array still contains that
  one account; the UI is what gates on `accounts.length > 1`.

## UI

### New component `app/_components/dashboard/AccountLowList.tsx`

Parallel to `AccountBalanceList` but **read-only** (no inline editing):

- Returns `null` when `accounts.length <= 1`.
- One row per account, in account order, showing:
  - Label: `name` for DEBIT, `name (available)` for CREDIT.
  - Figure: `availableCredit` for CREDIT, `balance` for DEBIT — red
    (`text-finance-expense`) when `< 0`, else `text-foreground`.
  - Date: that account's own lowest date (`formatUtcMonthDay` or similar).
- Whole row is a button calling `onSelect(date)` → `scrollToDay(date)`.
- Same visual shell as `AccountBalanceList`: `mt-3 space-y-1 border-t pt-2`.

Rows are keyed/joined by `accountId`, pulling the label/type from the account
list and the figure/date from `lowestByAccount`.

### Wiring (`app/page.tsx`)

Pass `AccountLowList` into the existing "Lowest Balance" `MetricCard`'s `footer`,
threading `accounts`, `result.lowestByAccount`, and an `onSelect` that calls the
existing `scrollToDay`. Headline value is unchanged.

## Testing

Primary coverage is the engine (Vitest):

- **Multi-account, staggered lows:** accounts bottom out on *different* days;
  assert each `AccountLow` has the correct minimum figure and date.
- **Tie-break:** an account hits the same low figure twice; assert the earliest
  date wins.
- **CREDIT account:** assert the low is measured on `availableCredit` (most
  drawn down), not raw balance.
- **Single account:** `lowestByAccount` has exactly one entry; UI gating is
  separate.
- **Empty days:** `lowestByAccount` is `[]`.

Component render coverage is light; the figure/label/date logic is exercised via
the engine.

## Out of Scope

- No editing from the Lowest card (unlike Current Balance).
- No change to the combined headline or the sparkline.
- No new engine inputs; derived entirely from existing `days[*].accounts`.
