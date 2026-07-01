# Items list: recurrence labels, all-accounts view, add-form account selection

**Date:** 2026-07-01
**Status:** Design approved, pending spec review

## Summary

Three related changes to the Items page (`app/particulars/`), plus one bug fix:

1. **Human-readable recurrence labels** — replace the raw `frequency (N)` text with
   phrasing like "Every 14th", "Every Monday", "This Tue" / "Next Tue".
2. **All-accounts view** — the Items page shows items from *every* account the user
   is a member of, each row badged with its account. Transfers appear on both their
   from-account (negative) and to-account (positive).
3. **Account selection on Add forms** — QuickAdd and the full ParticularForm gain an
   Account selector. Edit/update does **not**; changing an item's account is done via
   the existing **Move** action.
4. **Bug fix** — the Delete button currently deletes immediately; wire it to the
   existing confirmation dialog.

Out of scope: the engine, forecast, dashboard, spending, and holidays pages are
unchanged. They remain scoped to the active account. Only the Items page goes
cross-account.

## Background

- The app supports **multiple accounts per user** via `AccountMembership` (the stale
  "one account per user" line in CLAUDE.md predates this). A global account switcher
  (`AccountContext`) sets an active account used by Dashboard, Spending, Holidays, and
  today by Items.
- `particular.list` is an `accountProcedure` returning only rows where
  `accountId === activeAccount`. A transfer (with `toAccountId`) therefore appears only
  on its from-account.
- Per-account permissions come from the membership: `canEditItems` etc.
- Repo convention: engine/label logic never reads the clock — "today" is passed in as a
  UTC-anchored `Date`. UTC accessors are used for all date field extraction.

## Part 1 — Recurrence labels

### New pure helper

`app/particulars/frequencyLabel.ts` — no React, no Prisma. Vitest-covered.

```ts
export function frequencyLabel(
  p: { frequency: Frequency; startDate: Date },
  today: Date,
): string
```

Behaviour by frequency (all date fields read via UTC accessors):

| Frequency    | Output           | Derivation |
|--------------|------------------|------------|
| `MONTHLY`    | `Every 14th`     | ordinal of `startDate.getUTCDate()` |
| `WEEKLY`     | `Every Monday`   | full UTC weekday of `startDate` |
| `FORTNIGHTLY`| `This Tue` / `Next Tue` / `Every other Tue` | see below |
| `ANNUAL`     | `Every 26th Aug` | ordinal day + short UTC month of `startDate` |
| `ONCE_OFF`   | `26th Aug, 2026` | ordinal day + short UTC month + UTC year |

**Fortnightly derivation.** Step `startDate` forward in 2-week increments until the
first occurrence `>= today` (reuse the engine's cadence: `addWeeks(date, 2)`). Compare
that occurrence's **Mon–Sun week** to today's Mon–Sun week:

- Same week → `This <weekday>`
- The immediately following week → `Next <weekday>`
- Any week further out (e.g. the item is skipped/paused so the next hit is 2+ weeks
  away) → `Every other <weekday>`

Weekday in the label is the short UTC weekday of the **occurrence** (which equals the
start date's weekday, since fortnightly preserves weekday). "Mon–Sun week" = the
Monday-anchored 7-day block containing a date; compute each date's Monday and compare.

### New date helpers (`lib/dateInput.ts`)

Added alongside the existing UTC formatters, same pattern (`Intl.DateTimeFormat` with
`timeZone: "UTC"`):

- `formatUtcWeekdayLong(date)` → `"Monday"` (`weekday: "long"`)
- `ordinal(n)` → `"1st" | "2nd" | "3rd" | "14th" | ...` (pure integer helper)

`formatUtcWeekday` (short, `"Tue"`), `formatUtcMonthDay`-style month access already
exist and are reused where possible.

### Client change (`page.tsx`)

Replace the inline block (currently lines 92–95):

```tsx
<span className="ml-2 text-xs text-muted-foreground ">{p.frequency.toLowerCase()} (
  {p.frequency === "MONTHLY" && p.startDate.getUTCDate()}
  {p.frequency === "FORTNIGHTLY" && formatUtcWeekday(p.startDate)}
)</span>
```

with:

```tsx
<span className="ml-2 text-xs text-muted-foreground">{frequencyLabel(p, today)}</span>
```

`today` is `todayAsUtcDate()` computed once in the component body (from
`lib/dateInput.ts`). No surrounding parentheses.

## Part 2 — All-accounts view

### Server: new query `particular.listAll`

A `protectedProcedure` (not `accountProcedure` — it spans accounts):

1. Resolve the user's account memberships (same source as `account.list`, only open
   accounts).
2. Fetch all `Particular` rows where `accountId ∈ userAccountIds`, `include: { overrides: true }`.
3. Build the returned rows:
   - **Normal / from-account rows** (`direction: "OUT"`): every fetched row, tagged
     with `accountId`, `accountName`, and that membership's `canEditItems`.
   - **Incoming transfer echoes** (`direction: "IN"`): for each fetched `TRANSFER`
     whose `toAccountId ∈ userAccountIds`, emit an additional synthetic row attributed
     to the **to-account** (its `accountId`, `accountName`), carrying the same
     particular data, `direction: "IN"`, and `canEditItems: false` (echoes are
     read-only from the receiving side).

Return type (per row) extends the existing particular shape with:

```ts
{
  ...particular,          // id, name, type, amount, frequency, startDate, overrides, ...
  accountId: string,      // the account this row is displayed under
  accountName: string,
  direction: "OUT" | "IN",
  canEditItems: boolean,  // per the row's account membership; false for IN echoes
}
```

Notes:
- A transfer between two of the user's *own* accounts yields two rows (OUT on from, IN
  on to). A transfer to an account the user isn't a member of yields only the OUT row.
- `IN` echoes reuse the same particular `id`. The client must key rows by
  `id + direction` (or `id + accountId`) to keep React keys unique.

### Client: `page.tsx` switches to `listAll`

- Query: `trpc.particular.listAll.useQuery()` (no `accountId` arg).
- Sectioning unchanged: Recurring Transfers / Income / Expenses / Once-offs, filtered
  on `type` / `frequency` exactly as now. `IN` echoes are `TRANSFER` type → they land
  in the Transfers section alongside `OUT` rows.
- **Account badge**: an inline pill after the name (same visual weight as
  `CategoryPill`), showing `accountName`. Applies to all rows.
- **Amount sign**:
  - Income → `+amount`
  - Expense → `−amount`
  - Transfer `OUT` → `−amount`
  - Transfer `IN` → `+amount`
- **Row actions** gate on the **row's** `canEditItems` (not the global
  `activeMembership`). `IN` echoes have `canEditItems: false` → Edit/Move/Delete
  disabled/hidden. Edit and Delete pass the **row's** `accountId` to the mutation, not
  the active account.
- **Move** unchanged in behaviour; shown only for non-transfer, editable rows as today.

### Optimistic cache migration

`QuickAddRow` (add) and `page.tsx` (delete) currently read/write the
`particular.list` cache keyed by `{ accountId }`. They move to the `listAll` cache
(a single flat list, no key args):

- **Add**: append the new row to `listAll` with `direction: "OUT"`, the chosen
  `accountId`/`accountName`, and `canEditItems: true`.
- **Delete**: remove rows matching the deleted `id` from `listAll`. (Deleting a
  transfer removes both its OUT row and any IN echo, since both share the id — filter
  on `id`, keep rows whose id differs.)
- `onSettled` invalidates `particular.listAll` (and forecast) instead of
  `particular.list`.

The old `particular.list` query may remain for any other caller; audit usages and only
migrate the Items page + its optimistic helpers. (If no other caller exists, `list` can
stay as-is untouched — it is not removed by this work.)

## Part 3 — Account selection on Add forms

Both add paths gain an **Account** selector; edit does not.

### QuickAddRow

- Add an Account `<Select>` (options = `accounts` from `useActiveAccount()`), default =
  current `accountId`. Store the selection in form state (extend defaults with the
  active account id) or local state.
- `submit` passes the **selected** account id to `create.mutate({ accountId: selected, ...})`.
- After submit, reset the account selection back to the active account (matching the
  "reset for next entry" behaviour).

### ParticularForm (full add)

- When creating (no `particularId`), render an Account `<Select>` (same options,
  default = active account); its value is passed as `accountId` to `create`.
- When editing (`particularId` set), the selector is **not rendered**. The account is
  fixed; the user Moves the item to change it.

Both selectors only list accounts where the user `canEditItems` (you can only add items
to accounts you may edit).

## Part 4 — Delete confirmation bug fix

`page.tsx` already has `pendingDelete` state and a confirmation `<Dialog>`, but the
row's Delete button calls `del.mutate(...)` directly, bypassing confirmation. Fix:

- Row Delete button → `onClick={() => setPendingDelete(p)}` (opens the dialog).
- The dialog's confirm button already calls `del.mutate` with the pending row — update
  it to use `pendingDelete.accountId` (the row's account) rather than the active
  `accountId`, consistent with the all-accounts change.

## Testing

- **`frequencyLabel`** (Vitest, `frequencyLabel.test.ts`): a case per frequency;
  fortnightly cases for This / Next / Every-other across a Mon–Sun week boundary;
  ordinal edge cases (1st, 2nd, 3rd, 11th–13th, 21st, 22nd, 23rd). `today` passed in.
- **`ordinal`** helper: direct unit tests for the tricky teens/ones.
- **`particular.listAll`** (server test, following existing router test patterns):
  own-account rows tagged correctly; transfer to own account yields OUT + IN with
  correct account attribution and `canEditItems`; transfer to a non-member account
  yields only OUT; `IN` echo has `canEditItems: false`.
- Existing tests for `particular.list` / QuickAdd remain green (or are migrated with
  their callers).

## Key decisions

- Fortnightly This/Next uses a **Mon–Sun** week boundary.
- Annual is labelled explicitly (`Every 26th Aug`).
- Transfers list on **both** accounts (OUT negative, IN positive), IN read-only.
- Only the **Items page** goes cross-account; all other pages stay per-active-account.
- Account badge is an **inline pill after the name** (CategoryPill styling).
- Add forms get an Account selector; **edit does not** — Move is the account-change path.
