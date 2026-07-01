# Inline category display & editing in the items list

**Date:** 2026-06-29
**Status:** Approved

## Goal

On the "Items" page (`app/particulars/page.tsx`), show each expense's
category inline in its row, and let the user edit it inline (click to edit, type-ahead,
save on select/blur) without opening the full edit form.

Categories are **expense-only** in this app (`Particular.category String?`, surfaced
only for `type === "EXPENSE"`). Income rows are unchanged.

## Scope

- `app/particulars/page.tsx` — render a category pill in expense rows.
- New `app/particulars/CategoryPill.tsx` — the display + inline-edit component.
- New `lib/schemas/toParticularInput.ts` (+ test) — shared particular → `particularInput`
  mapping helper.
- `app/particulars/ParticularForm.tsx` — refactor its field mapping to use the shared
  helper (so the inline edit and the form can't drift).

Out of scope: income rows, the spending page, any change to the engine or server routers.

## Display

- Each **expense** row shows a category pill immediately after the item name, using the
  existing `Badge` component (`app/_components/ui/badge.tsx`), muted variant, with a ▾
  affordance to signal it is editable.
- Uncategorized expenses show a faint `+ Category` prompt in the same slot.
- Income rows render exactly as today (no pill).

```
Recurring Expenses
┌────────────────────────────────────────┐
│ Rent  [Housing ▾]          -$2,000  Edit│
│ Power [+ Category]           -$180   Edit│
└────────────────────────────────────────┘
```

## Inline edit — `CategoryPill.tsx`

A small client component. Props: the row's `particular`.

- **Idle:** renders the pill (category name, or faint `+ Category`).
- **Click pill → editing:** swaps to an inline text `<input list="category-options">`,
  reusing the existing `category-options` datalist sourced from `trpc.category.list`.
  Auto-focus the input; preselect existing text.
- **Save on select/blur:**
  - Enter, or picking a datalist option → commit.
  - Blur → commit the typed value.
  - Esc → cancel, restore prior value, return to idle.
- **Empty = clear:** committing an empty/whitespace value sets `category` to `null`;
  the pill reverts to `+ Category`. (Matches the existing null-coercion contract in
  `particular.update`: payload carries `category: null`, never `undefined`, when cleared.)
- Normalization (trim, title-case, blank→undefined) is handled server-side by
  `particularInput` / `normalizeCategory`; the client sends the raw string.

### Save path

`particular.update` requires the **entire** `particularInput` (`particularInput.and({id})`).
The component reconstructs the full payload from the row's particular via the shared
`toParticularInput(p)` helper, overriding only `category`, then calls
`update.mutate({ ...payload, category, id })`.

- **Optimistic:** the pill shows the new value immediately.
- **On success:** invalidate `particular.list` and `forecast.getData` (category changes
  feed the spending view, which is derived from forecast data).
- **On error:** `toast.error(...)` and revert to the prior value.

### Row interaction conflict

The item name is currently a `<button>` that toggles the override-management panel
(`setExpanded`). The pill sits beside it as a separate interactive element. Pill clicks
(and the input's events) must `stopPropagation` so editing the category never toggles the
expand panel.

## Shared mapping helper — `lib/schemas/toParticularInput.ts`

Extract the particular → form-values mapping currently inlined in `ParticularForm`'s
`values` block into a pure helper:

```ts
toParticularInput(p: Particular): z.input<typeof particularInput>
```

Field mapping (matches the form today):
- `amount` → `Math.abs(Number(p.amount))`
- `startDate` → `new Date(p.startDate)`
- `endDate` → `p.endDate ? new Date(p.endDate) : undefined`
- `category` → `p.category ?? ""`
- all other fields pass through (`name`, `type`, `frequency`, `isCritical`, `isFixed`,
  `businessDayAdjustment`).

`ParticularForm` is refactored to build its `values` from this helper, so the form and the
inline edit share one source of truth and can't drift.

## Testing (Vitest)

The repo has no jsdom/RTL — tests are pure-logic `.test.ts` (e.g. `sortEvents.test.ts`).
So we test the **helper**, not the rendered component:

`lib/schemas/toParticularInput.test.ts`:
- A mapped particular passes `particularInput.parse(...)` (round-trips to a valid input).
- `category: null` → `""` in the output.
- Once-off / no `endDate` → `endDate` is `undefined`.
- Expense amount is positive (abs) in the output.

The `CategoryPill` component itself is verified by hand in the running app (no component
test harness exists in this slice).

## Workflow

Implement in a git worktree, then merge to `main` locally and push.
