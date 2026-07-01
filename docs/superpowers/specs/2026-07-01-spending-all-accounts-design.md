# Spending: combine all accounts + working Untagged fixer

**Date:** 2026-07-01
**Status:** Approved

## Problem

The Spending page (`app/spending/page.tsx`) currently loads `particular.list`, which
is scoped to the **active account only**. The user wants spending to reflect their whole
financial picture: recurring income/expenses **combined across all accounts**, excluding
transfers. Separately, the **Untagged** section should reliably list every expense with no
category and let the user fix it inline on the same page — this was effectively empty/broken
because it only ever saw the active account.

## Decisions

- **Scope:** Always all accounts. The Spending page ignores the active-account selector and
  aggregates every account the user can see (via `particular.listAll`).
- **Transfers:** Excluded. They are `type: "TRANSFER"` particulars. **Note:** `buildSpending`
  previously treated any non-INCOME row as an expense, so transfers WERE being counted — this was
  a latent bug surfaced during verification (an $8,000/mo transfer inflated spending). Fixed by
  only summing explicit `EXPENSE`. Covered by a new test.
- **Once-offs:** Non-recurring (`ONCE_OFF`) expenses are never factored into spending, and the
  Untagged fixer likewise lists only recurring uncategorized expenses.
- **Retag permissions:** Respect per-row `canEditItems`. Untagged/expense rows from accounts the
  user cannot edit render with the `CategoryCombobox` disabled.
- **Account badge:** Each expense/untagged row shows a color-coded `AccountBadge`, matching the
  items page.

## Changes

### Engine — `lib/spending/spending.ts`
No behavior change required (`buildSpending` already ignores non-INCOME/EXPENSE and ONCE_OFF).
Add a `spending.test.ts` case asserting TRANSFER rows contribute nothing to categories,
`untagged`, `totalExpense`, or `monthlyIncome`.

### Page — `app/spending/page.tsx`
- Fetch `trpc.particular.listAll` instead of `particular.list`. Drop the `accountId`-gated query.
- Map `listAll` rows into `SpendingParticular[]` for `buildSpending` (unchanged shape).
- Expense/untagged list rows come from `listAll` filtered to `type === "EXPENSE" && frequency !== "ONCE_OFF"`.
- **Retag** writes with each row's own `accountId` (not the active account) so cross-account
  retags hit the right account. Optimistic cache updates move to the `listAll` key
  (`utils.particular.listAll`), mirroring the items page.
- Disable `CategoryCombobox` per row when `row.canEditItems` is false.
- Render `AccountBadge` next to each row name, using `account.list` for names/order (same pattern
  as `app/particulars/page.tsx`).

### CategoryCombobox
Left as-is: it reads category options from the active account's `category.list`. In an all-accounts
view this is imperfect but acceptable — the user can still type/create any category name. Not
expanding to a union of all accounts' categories in this slice (YAGNI).

## Testing

- Vitest: extend `lib/spending/spending.test.ts` with a transfers-excluded case.
- Manual: run the app; confirm combined totals across accounts, transfers absent, Untagged lists
  cross-account untagged expenses, retag persists, and non-editable rows are read-only.
