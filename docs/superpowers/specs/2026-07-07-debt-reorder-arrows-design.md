# Debt reorder arrows — design

**Date:** 2026-07-07

## Problem

The Debt Buster has three payoff strategies: Snowball, Avalanche, and Custom. Custom pays
debts in the order given by `customOrder`, which the page derives from the debt list order
(`debts.map(d => d.id)`). But the list order is `sortOrder` from the DB, and **there is no
UI to change it** — no drag, no arrows. So Custom is effectively inert: it pays in an
arbitrary fixed order the user can't control.

## Goal

Let the user reorder their debts so the Custom strategy pays them in their chosen priority.
Reordering is done with **up/down arrow buttons** on each debt card (no drag-and-drop).

## What already exists (no work needed)

- **`debt.reorder` tRPC mutation** (`server/routers/debt.ts:50`) accepts `{ ids: string[] }`,
  validates via `assertReorderIds` (must be an exact permutation of the user's debts — no
  missing/extra/duplicate ids), and writes `sortOrder = index` in a transaction.
- **`debt.list`** returns rows ordered by `sortOrder asc`.
- **`page.tsx`** already derives `customOrder = debts.map(d => d.id)` and feeds it to the
  simulation, so a new persisted order flows into the Custom sim + chart automatically.

The gap is entirely client-side: nothing calls `reorder`, and the cards have no arrows.

## Changes

### 1. `app/debts/moveItem.ts` (+ `.test.ts`)

Pure helper, the only real logic here, tested per repo convention.

```ts
export function moveItem<T>(items: T[], index: number, direction: "up" | "down"): T[]
```

Returns a **new array** with the element at `index` swapped with its neighbor in
`direction`. No-op (returns an equal-order new array, or the same reference — pick one and
test it) when the move would go out of range (moving the first item up, last item down, or
an out-of-range index). Generic so it works on the id array.

Tests: move middle up, move middle down, move-up at index 0 (no-op), move-down at last
index (no-op), out-of-range index (no-op), single-element array, does not mutate input.

### 2. `app/debts/DebtCard.tsx`

Add up/down controls next to the existing delete `X`:

- New props: `onMoveUp: () => void`, `onMoveDown: () => void`, `canMoveUp: boolean`,
  `canMoveDown: boolean`.
- Render `ChevronUp` / `ChevronDown` (lucide) buttons, `disabled` at the ends
  (`!canMoveUp` / `!canMoveDown`).
- Each button calls `e.stopPropagation()` before its handler so it does not trigger the
  card's `onEdit` click — same pattern as the existing delete button.
- Styling mirrors the delete button (muted, hover accent, focus ring).

### 3. `app/debts/page.tsx`

- Add a `reorder` mutation (`trpc.debt.reorder.useMutation`) with an **optimistic** update
  mirroring the existing `create`/`delete` pattern: `onMutate` cancels + snapshots
  `debt.list`, sets the reordered rows, returns `{ prev }`; `onError` rolls back + toasts;
  `onSettled` invalidates.
- A `move(id, direction)` handler computes `nextIds = moveItem(rows.map(r => r.id), idx,
  direction)` and calls `reorder.mutate({ ids: nextIds })`. The optimistic `setData`
  reorders `rows` to match `nextIds`.
- Pass `onMoveUp`/`onMoveDown`/`canMoveUp`/`canMoveDown` to each `DebtCard` based on its
  index in `rows`.

Controls are **always visible**, not gated to the Custom strategy — the order is meaningful
metadata regardless, and gating adds state for little benefit.

## Data flow

arrow click → `move(id, dir)` → `moveItem` produces new id array → optimistic `setData`
reorders `rows` → `reorder.mutate({ ids })` persists `sortOrder` → `onSettled` invalidates.
`customOrder` re-derives from `rows`, so the Custom sim + chart update live.

## Out of scope

- Drag-and-drop (arrows only, per user).
- Schema / migration changes (`sortOrder` and `reorder` already exist).
- Engine changes (`orderDebts` custom path already consumes `customOrder`).

## Testing

- `moveItem` gets a co-located `.test.ts` (cases above).
- `assertReorderIds` is already covered server-side.
