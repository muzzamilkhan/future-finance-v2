# Particulars quick-add + optional end-date fix — design

Date: 2026-06-28

## Problem

Adding an income or expense requires opening a modal and filling a full form
(name, type, amount, frequency, start date, end date, critical, fixed,
business-day adjustment). Most additions only need a few fields. Two issues:

1. **No fast path to add an item.** Every add goes through the full modal.
2. **End date behaves as required even though it is meant to be optional.**
   The schema marks `endDate` as `.optional()` and the modal labels it
   "(optional)", but an empty `<input type="date">` with
   `register(..., { valueAsDate: true })` produces `null`. `z.coerce.date()`
   coerces `null` to `1970-01-01` instead of leaving it undefined (an empty
   string `""` instead throws). A blank end date therefore silently becomes a
   1970 end date, so the item ends immediately and generates no future
   instances. Verified empirically against the project's installed Zod.

## Goals

- Provide a minimal inline quick-add for the common case.
- Make a blank end date reliably mean "no end date" everywhere.

## Non-goals

- No changes to the forecast engine or forecast router.
- No redesign of the existing edit modal beyond the shared schema fix.
- No new component-test framework (no `@testing-library` is installed).

## Design

### 1. Schema fix — `lib/schemas/particular.ts`

Normalize empty end-date values to `undefined` before coercion:

```ts
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
// ...
endDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
```

This fixes the 1970 bug for both the quick-add row and the existing edit modal,
since both submit through `particularInput`. The existing
`endDate >= startDate` refine is unaffected (it already guards on
`!v.endDate`).

### 2. Quick-add component — `app/particulars/QuickAddRow.tsx` (new)

A persistent inline row rendered below the list (spreadsheet "new row" style).
Minimal inputs on one line:

- **Name** — text input.
- **Type** — compact `Select` (INCOME / EXPENSE) reusing the existing
  `app/_components/ui/select` primitive. No toggle primitive exists; do not add
  one.
- **Amount** — number input, `step="0.01"`, positive.
- **Start date** — date input, defaults to today.
- **Add** — submit button; Enter in any field also submits.

Hidden fields use the **same defaults as the current modal**:
`frequency: "MONTHLY"`, `isCritical: true`, `isFixed: true`,
`businessDayAdjustment: "NONE"`, `endDate: undefined`.

Submission calls the existing `particular.create` mutation. On success it
invalidates `particular.list` and `forecast.getData` (matching the modal's
`onDone`), then resets the row to blank with start date back to today so the
user can keep adding. Validation errors (empty name, non-positive amount)
display inline without clearing the other inputs.

The component uses `react-hook-form` + `zodResolver(particularInput)` with the
`z.input<typeof particularInput>` value type, consistent with `ParticularForm`.

### 3. Page wiring — `app/particulars/page.tsx`

Render `<QuickAddRow />` at the bottom of the list. The existing top **Add**
button and modal remain unchanged — quick-add is additive. The modal continues
to be the path for the full option set (frequency, critical, fixed, end date,
business-day adjustment), and remains the editor for existing items, which is
where the "more options" surface for editing already lives.

## Testing

- **Vitest (schema):** add cases to `lib/schemas/particular.test.ts` covering
  `endDate` of `""`, `null`, and `undefined` all parsing to `undefined`, and a
  valid date string parsing through; confirm the start/end refine still holds.
- **Quick-add UI:** verified manually (no component-test harness installed).
  Adding a new component-test stack is out of scope.

## Risks

- Empty-date normalization could in theory mask a genuinely invalid date
  string. Acceptable: the only "empty" values an `<input type="date">` yields
  are `""`/`null`, and any non-empty value still flows through `coerce.date`.
