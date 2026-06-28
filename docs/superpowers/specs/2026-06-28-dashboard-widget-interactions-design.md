# Dashboard Widget Interactions — Design

Date: 2026-06-28

## Goal

Make three dashboard metric widgets interactive:

1. **Lowest Balance** — show the date it occurs; clicking scrolls to that day's card.
2. **Next Negative** — show the date it occurs; clicking scrolls to that day's card.
3. **Current Balance** — click to edit inline; Enter/✓ saves, ✕/Escape cancels.

## Context

- Dashboard lives in `app/page.tsx` (client component). It computes a forecast via
  the pure engine and renders four `MetricCard`s plus a list of `DailyCard`s.
- `result.lowest` and `result.firstNegative` are `DailyBalance | null`, each carrying
  a `date` and `closingBalance`.
- Daily cards currently render **only for days with events**
  (`result.days.filter((day) => day.events.length > 0)`), so a lowest/next-negative
  day with no events has no card to scroll to.
- Existing balance editing is via an "Update balance" button → `UpdateBalanceModal`
  (`account.updateBalance` mutation). This is being **replaced** by inline edit.

## Design

### MetricCard changes (`app/_components/dashboard/MetricCard.tsx`)

Add two optional, independent capabilities:

- `onClick?: () => void` — when set, the card is clickable (cursor-pointer, hover
  affordance) and invokes `onClick`. Used by Lowest/Next Negative.
- Editable mode for Current Balance: `editable?: boolean` + `onSave?: (value: number)
  => void`. When `editable`, clicking the card enters edit mode: the big number is
  replaced by a number `Input` (seeded with the current value) and ✓ (save) / ✕
  (cancel) icon buttons.
  - Enter or ✓ → `onSave(Number(value))`, then exit edit mode.
  - ✕ or Escape → discard, exit edit mode.
  - State (editing flag, draft value) is local to `MetricCard`.

### Date subtitles + scroll-to (`app/page.tsx`)

- Lowest Balance card: `subtitle = format(result.lowest.date, "EEE, MMM d")` and
  `onClick` scrolls to that day. Omit subtitle/onClick when `result.lowest` is null.
- Next Negative card: same, using `result.firstNegative`.
- Scroll handler: `scrollToDay(date)` finds the DOM element by id and calls
  `scrollIntoView({ behavior: "smooth", block: "center" })`.

### Day card scroll targets

- `DailyCard` gets a stable DOM `id` from its date: `day-<yyyy-MM-dd>`.
- The daily-list filter is widened so the lowest and next-negative days always render
  a card even with no events:
  `day.events.length > 0 || isSameDay(day.date, lowest) || isSameDay(day.date, firstNegative)`.
  An empty-events card already renders its date + closing balance.

### Remove modal

- Delete the "Update balance" button from the header and delete
  `app/_components/dashboard/UpdateBalanceModal.tsx`. Inline edit is the only path.

## Testing

The repo's Vitest setup runs in a `node` environment and includes only
`lib/**` and `server/**` — there is no React component test harness, and this change
adds no engine/schema logic. Verification is by running the app and exercising the
three interactions manually. No new unit tests.

## Files touched

- `app/_components/dashboard/MetricCard.tsx` — onClick + editable mode
- `app/_components/dashboard/DailyCard.tsx` — stable `id`
- `app/page.tsx` — subtitles, scroll handler, widened filter, remove button/modal
- `app/_components/dashboard/UpdateBalanceModal.tsx` — deleted
