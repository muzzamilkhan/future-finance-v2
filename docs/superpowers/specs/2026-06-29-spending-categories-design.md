# Spending & Categories — Design

Date: 2026-06-29

## Goal

Add a **Spending** section (and nav item) that lets a user tag each expense with a
category, then visualize monthly spend per category as a donut chart with a
**Surplus** slice (or a **Deficit** callout when expenses exceed income).

## Scope

In:
- Per-user category list (comma-separated column on `User`).
- Tagging an EXPENSE particular with a category (existing or new).
- Server-side normalization (trim, collapse whitespace, capitalize) on save.
- Server-side cleanup: categories with zero tagged expenses are removed.
- A pure, tested spending engine that normalizes all recurrence frequencies to a
  monthly-equivalent amount.
- `/spending` page: donut chart + category legend with inline retagging.
- "Spending" nav item in both `Sidebar` and `BottomNav`.

Out (not now):
- Categories for INCOME particulars (expenses only).
- Spending targets / per-category limits.
- Coupling the spending to the forecast engine / a date window.

## Data model

`prisma/schema.prisma`:

- `User.categories String @default("")` — comma-separated, user-specific category
  list. This is a **derived cache**: it is rewritten from the actual set of
  categories referenced by the user's expenses after every expense mutation, so it
  cannot drift.
- `Particular.category String?` — nullable. The expense's tagged category **name**
  (matches a token in `User.categories`). Income particulars ignore it.

Migration adds both columns; no backfill required (defaults cover existing rows).

## Category normalization

A single helper (`lib/spending/category.ts`, pure, tested):

- `normalizeCategory(raw: string): string` — trim, collapse internal runs of
  whitespace to single spaces, capitalize the first letter of each word
  (title-case), return `""` for blank input.
- `parseCategories(csv: string): string[]` / `serializeCategories(names: string[]): string`
  — split/join on `,`, dropping blanks, de-duplicating case-insensitively, sorted
  alphabetically.

Keep `lib/spending/` free of React/Prisma/Next imports (same rule as `lib/engine/`).

## Server behavior

On EXPENSE create/update with a `category`:
1. Normalize the incoming category (`normalizeCategory`). Empty → store `null`.
2. Persist the particular with the normalized category.

After **every** expense create / update / delete (the cleanup pass):
1. Recompute the distinct set of non-null categories across the user's expenses.
2. `serializeCategories(...)` that set and write it to `User.categories`.

This drops orphaned categories automatically and keeps the column authoritative.

New `category` tRPC router:
- `list` — returns `parseCategories(user.categories)` (string[]) for the tagging
  combobox.

The cleanup logic lives in a shared helper called by the particular router's
create/update/delete (e.g. `syncUserCategories(prisma, userId)`).

## Spending engine — `lib/spending/`

Pure, deterministic, exhaustively Vitest-covered (per repo convention for
`lib/engine/`).

- `toMonthly(amount: number, frequency: RecurrenceFrequency): number`
  - WEEKLY → `amount * 52 / 12`
  - FORTNIGHTLY → `amount * 26 / 12`
  - MONTHLY → `amount`
  - ANNUAL → `amount / 12`
  - ONCE_OFF → `0` (excluded from the recurring spending)

- `buildSpending(particulars): SpendingSummary`
  ```ts
  type SpendingCategory = { name: string; monthly: number };
  type SpendingSummary = {
    categories: SpendingCategory[]; // tagged expense categories, monthly totals, desc
    untagged: number;            // monthly total of expenses with no category
    totalExpense: number;        // sum of all monthly expense (incl. untagged)
    monthlyIncome: number;       // monthly-equivalent income total
    surplus: number;             // monthlyIncome - totalExpense (negative = deficit)
  };
  ```
  Amounts use `Math.abs` on the stored positive `amount`; sign comes from `type`.
  ONCE_OFF particulars contribute 0 and are excluded.

## Tagging UI

**Particular form** (`app/particulars/ParticularForm.tsx`):
- A **Category** combobox shown only when `type === "EXPENSE"`.
- Implemented as an `<input>` backed by a `<datalist>` populated from
  `category.list` — lets the user pick an existing category or type a new one.
- Wired into the form values; sent as `category` on create/update.

**Spending page** (`/spending`):
- Each category in the legend is expandable to list its expenses, with an inline
  control to reassign (combobox) or clear the category of each expense. Uses the
  existing `particular.update` mutation; the cleanup pass keeps the list tidy.

## Spending page & chart

`app/spending/page.tsx` (client component), donut via `recharts` (already a dep):

- One slice per expense category, plus an **Untagged** slice if `untagged > 0`.
- When `surplus > 0`: a **Surplus** slice sized to the surplus.
- Center label: monthly **total expense**.
- **Deficit** (`surplus < 0`): no surplus slice; show a prominent red
  **"Deficit: −$X"** banner; center total and deficit-state styling recolor red.
- Below the chart: a legend listing each category with its monthly amount,
  expandable for inline retagging (above).
- Currency via existing `formatCurrency` (NZD).

## Nav

Add a "Spending" item (lucide `PieChart` icon), route `/spending`, to:
- `app/_components/Sidebar.tsx`
- `app/_components/BottomNav.tsx`

## Testing

- `lib/spending/category.test.ts` — normalize (trim/whitespace/capitalize/blank),
  parse/serialize (dedup case-insensitive, sort, drop blanks).
- `lib/spending/spending.test.ts` — `toMonthly` across all frequencies; `buildSpending`
  surplus, deficit, untagged, empty, income-only, expense-only.
- `server/routers/category.test.ts` (or extend `particular.test.ts`) —
  normalization on save; cleanup removes orphaned categories; `category.list`.
- Mirror the style of the existing `server/routers/particular.test.ts`.

## Invariants preserved

- `Particular.amount` stays positive; sign applied from `type` in the engine.
- `lib/spending/` has no React/Prisma/Next imports.
- One `FinanceAccount` per user; categories live on `User` (per-user list).
