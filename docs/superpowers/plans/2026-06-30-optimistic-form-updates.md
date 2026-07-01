# Optimistic Form Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every data-list form (holidays, income/expense, category changes, overrides, balance) reflect its change in the UI immediately, with the server reconciling in the background and rolling back on error.

**Architecture:** Use React Query's optimistic-update lifecycle (`onMutate` patches the query cache + snapshots, `onError` rolls back + toasts, `onSettled` invalidates to reconcile). A small pure helper module `lib/optimistic.ts` builds the three list operations (add/update/remove) so all 12 call sites stay short and consistent. The computed `forecast.getData` query is never optimistically patched — it stays on `invalidate`.

**Tech Stack:** Next.js 16, React 19, tRPC 11 (`createTRPCReact`), @tanstack/react-query 5, Tailwind 4, sonner (toasts), vitest 4 (node env).

## Global Constraints

- tRPC per-procedure utils expose `.cancel(input?)`, `.getData(input?)`, `.setData(input, updater)`, `.invalidate(input?)` via `trpc.useUtils()`.
- `particular.list` is keyed by `{ accountId }`. `particular.listOverrides` is keyed by `{ accountId, particularId }`. `holiday.list` by `{ accountId }`. `account.list` takes no input.
- `account.list` items use `currentBalance` (number) — NOT `balance`. The `updateBalance` mutation input is `{ accountId, balance }`.
- Temp optimistic rows use an id prefixed `optimistic-` via `` `optimistic-${crypto.randomUUID()}` ``.
- Pending visual style for temp rows: Tailwind `opacity-60 animate-pulse`.
- The vitest suite is node-environment only (`lib/**`, `server/**`, `app/**` `*.test.ts`); there is NO React component test harness. Only `lib/optimistic.ts` is unit-tested. Call-site behaviour is verified manually on the running dev server.
- Preserve every existing error surface (`toast.error`, etc.) exactly; add an `onError` rollback where one is missing.
- Do NOT start a dev server — one is assumed running per project convention; if you need one for manual checks, use your own `next dev -p <free port>`.

---

### Task 1: Optimistic list-cache helper (`lib/optimistic.ts`)

**Files:**
- Create: `lib/optimistic.ts`
- Test: `lib/optimistic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TEMP_ID_PREFIX = "optimistic-"`
  - `newTempId(): string` → `` `optimistic-${crypto.randomUUID()}` ``
  - `isTempId(id: string): boolean`
  - Pure list transforms over `readonly T[]` where `T extends { id: string }`:
    - `addRow<T>(rows: T[] | undefined, row: T): T[]` — prepend.
    - `updateRow<T>(rows: T[] | undefined, id: string, patch: Partial<T>): T[]` — replace matching by shallow-merge.
    - `removeRow<T>(rows: T[] | undefined, id: string): T[]` — filter out matching.
    - `upsertRowBy<T>(rows: T[] | undefined, match: (r: T) => boolean, row: T): T[]` — replace first match else prepend (for override upsert).

These are pure array functions (no React/tRPC) so they're unit-testable in the node vitest env. Call sites wire them into `onMutate`/`onError`/`onSettled` inline (Task 2+), which keeps the helper free of tRPC's non-uniform generated types.

- [ ] **Step 1: Write the failing test**

```ts
// lib/optimistic.test.ts
import { describe, it, expect } from "vitest";
import { addRow, updateRow, removeRow, upsertRowBy, newTempId, isTempId } from "./optimistic";

type Row = { id: string; name: string; n?: number };
const rows: Row[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

describe("optimistic list transforms", () => {
  it("addRow prepends", () => {
    expect(addRow(rows, { id: "c", name: "C" })).toEqual([
      { id: "c", name: "C" }, { id: "a", name: "A" }, { id: "b", name: "B" },
    ]);
  });

  it("addRow tolerates undefined", () => {
    expect(addRow(undefined, { id: "c", name: "C" })).toEqual([{ id: "c", name: "C" }]);
  });

  it("updateRow shallow-merges the matching row only", () => {
    expect(updateRow(rows, "b", { name: "B2", n: 5 })).toEqual([
      { id: "a", name: "A" }, { id: "b", name: "B2", n: 5 },
    ]);
  });

  it("updateRow on undefined returns []", () => {
    expect(updateRow(undefined, "b", { name: "x" })).toEqual([]);
  });

  it("removeRow filters the matching id", () => {
    expect(removeRow(rows, "a")).toEqual([{ id: "b", name: "B" }]);
  });

  it("upsertRowBy replaces first match", () => {
    expect(upsertRowBy(rows, (r) => r.id === "a", { id: "a", name: "A2" })).toEqual([
      { id: "a", name: "A2" }, { id: "b", name: "B" },
    ]);
  });

  it("upsertRowBy prepends when no match", () => {
    expect(upsertRowBy(rows, (r) => r.id === "z", { id: "z", name: "Z" })).toEqual([
      { id: "z", name: "Z" }, { id: "a", name: "A" }, { id: "b", name: "B" },
    ]);
  });

  it("newTempId is prefixed and detected by isTempId", () => {
    const id = newTempId();
    expect(id.startsWith("optimistic-")).toBe(true);
    expect(isTempId(id)).toBe(true);
    expect(isTempId("real-id")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/optimistic.test.ts`
Expected: FAIL — cannot find module `./optimistic`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/optimistic.ts
export const TEMP_ID_PREFIX = "optimistic-";

export function newTempId(): string {
  return `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;
}

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX);
}

export function addRow<T extends { id: string }>(rows: readonly T[] | undefined, row: T): T[] {
  return [row, ...(rows ?? [])];
}

export function updateRow<T extends { id: string }>(
  rows: readonly T[] | undefined, id: string, patch: Partial<T>,
): T[] {
  return (rows ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r));
}

export function removeRow<T extends { id: string }>(rows: readonly T[] | undefined, id: string): T[] {
  return (rows ?? []).filter((r) => r.id !== id);
}

export function upsertRowBy<T extends { id: string }>(
  rows: readonly T[] | undefined, match: (r: T) => boolean, row: T,
): T[] {
  const list = rows ?? [];
  return list.some(match) ? list.map((r) => (match(r) ? row : r)) : [row, ...list];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/optimistic.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/optimistic.ts lib/optimistic.test.ts
git commit -m "feat(optimistic): pure list-cache transforms helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Holidays — optimistic create & delete

**Files:**
- Modify: `app/holidays/page.tsx:49-54` (mutations), `:27-34` (row render for pending style)

**Interfaces:**
- Consumes: `addRow`, `removeRow`, `newTempId`, `isTempId` from `lib/optimistic.ts`.
- Produces: nothing downstream.

The `holiday.list` query is `{ accountId }`. A holiday row is
`{ id, name, date, isRecurring, source }`. Custom holidays created here use
`source: "CUSTOM"`.

- [ ] **Step 1: Replace the `create` and `del` mutations with optimistic versions**

In `app/holidays/page.tsx`, change the imports at the top to add:

```tsx
import { addRow, removeRow, newTempId, isTempId } from "@/lib/optimistic";
```

Replace lines 49-54 (`const create = …` through the `del` mutation) with:

```tsx
  const create = trpc.holiday.create.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId };
      await utils.holiday.list.cancel(key);
      const prev = utils.holiday.list.getData(key);
      utils.holiday.list.setData(key, (old) =>
        addRow(old, {
          id: newTempId(),
          name: vars.name,
          date: vars.date,
          isRecurring: vars.isRecurring,
          source: "CUSTOM",
        }),
      );
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) utils.holiday.list.setData(ctx.key, ctx.prev);
    },
    onSettled: () => { utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const del = trpc.holiday.delete.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId };
      await utils.holiday.list.cancel(key);
      const prev = utils.holiday.list.getData(key);
      utils.holiday.list.setData(key, (old) => removeRow(old, vars.id));
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) utils.holiday.list.setData(ctx.key, ctx.prev);
    },
    onSettled: () => { utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
```

- [ ] **Step 2: Add the pending style to temp rows**

In the `HolidaySection` row (currently line 28), change the wrapper `div`'s
`className` to dim temp rows. Replace:

```tsx
            <div key={h.id} className="flex items-center justify-between rounded-md border p-3">
```

with:

```tsx
            <div key={h.id} className={`flex items-center justify-between rounded-md border p-3${isTempId(h.id) ? " opacity-60 animate-pulse" : ""}`}>
```

Add the import to `HolidaySection`'s file scope (already added in Step 1 since it's the same file).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). The `holiday.list` row type must accept the
optimistic object; if TS complains about `date` (string vs Date), pass
`vars.date` as-is — the cached row type comes from the server query
(`date: Date`), and `vars.date` is a `Date` (the form does `new Date(date)`).

- [ ] **Step 4: Manual verification**

On the running app (Holidays page): add a custom holiday — it appears in
"Custom Holidays" instantly with a faint pulse, then settles. Delete one — it
disappears instantly. (Optional: throttle network in devtools to see the gap.)

- [ ] **Step 5: Commit**

```bash
git add app/holidays/page.tsx
git commit -m "feat(holidays): optimistic create and delete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Particulars list — optimistic create (QuickAddRow), delete (page), and pending row style

**Files:**
- Modify: `app/particulars/QuickAddRow.tsx:39-48`
- Modify: `app/particulars/page.tsx:35-37` (delete), `:54` (row pending style)

**Interfaces:**
- Consumes: `addRow`, `removeRow`, `newTempId`, `isTempId` from `lib/optimistic.ts`.
- Produces: the `particular.list` optimistic-create pattern reused by Task 4.

A `particular.list` row (`Particular`) has these fields the optimistic create
must populate: `id, name, type, amount, frequency, startDate, endDate,
isCritical, isFixed, businessDayAdjustment, category`. The QuickAddRow form
values (`QuickAddValues`) already carry all of these except `endDate`/`category`
(default `null`).

- [ ] **Step 1: QuickAddRow — make create optimistic**

In `app/particulars/QuickAddRow.tsx` add the import:

```tsx
import { addRow, newTempId } from "@/lib/optimistic";
```

Replace the `create` mutation (lines 39-48) with:

```tsx
  const create = trpc.particular.create.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId };
      await utils.particular.list.cancel(key);
      const prev = utils.particular.list.getData(key);
      utils.particular.list.setData(key, (old) =>
        addRow(old, {
          id: newTempId(),
          name: vars.name,
          type: vars.type,
          amount: vars.amount,
          frequency: vars.frequency,
          startDate: vars.startDate as Date,
          endDate: (vars.endDate as Date | undefined) ?? null,
          isCritical: vars.isCritical,
          isFixed: vars.isFixed,
          businessDayAdjustment: vars.businessDayAdjustment,
          category: vars.category ?? null,
        } as never),
      );
      return { prev, key };
    },
    onError: (error, variables, ctx) => {
      if (ctx) utils.particular.list.setData(ctx.key, ctx.prev);
      toast.error(`Couldn't add “${variables.name}”`, { description: error.message });
    },
    onSettled: () => {
      utils.particular.list.invalidate();
      utils.forecast.getData.invalidate();
    },
  });
```

Note: the success toast moves out (no `onSuccess` toast needed since the row is
already visible). Keep the form-reset behaviour in `submit` exactly as-is.

The `as never` cast on the row object guards against minor type drift between
the server row (Prisma Decimal for `amount`, etc.) and the form values; the
optimistic row only needs to render. If `npm run typecheck` passes without the
cast, remove it.

- [ ] **Step 2: Particulars page — make delete optimistic**

In `app/particulars/page.tsx` add the import:

```tsx
import { removeRow, isTempId } from "@/lib/optimistic";
```

Replace the `del` mutation (lines 35-37) with:

```tsx
  const del = trpc.particular.delete.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId };
      await utils.particular.list.cancel(key);
      const prev = utils.particular.list.getData(key);
      utils.particular.list.setData(key, (old) => removeRow(old, vars.id));
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) utils.particular.list.setData(ctx.key, ctx.prev);
    },
    onSettled: () => { utils.particular.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
```

- [ ] **Step 3: Particulars page — pending row style + guard Edit/Delete on temp rows**

In `renderRow` (line 54) replace:

```tsx
      <div key={p.id} className="rounded-md border p-3">
```

with:

```tsx
      <div key={p.id} className={`rounded-md border p-3${isTempId(p.id) ? " opacity-60 animate-pulse" : ""}`}>
```

And disable row actions for not-yet-confirmed rows. Replace the Edit and Delete
buttons (lines 70-71) with:

```tsx
            <Button variant="ghost" size="sm" disabled={!canEditItems || isTempId(p.id)} onClick={() => { setEditing(p.id); setFormOpen(true); }}>Edit</Button>
            <Button variant="ghost" size="sm" disabled={!canEditItems || isTempId(p.id)} onClick={() => del.mutate({ accountId: accountId!, id: p.id })}>Delete</Button>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification**

On the running app (Items): use the QuickAddRow to add an item — it
appears in the correct section instantly (pulsing), then settles; the form clears
immediately for the next entry. Delete an item — it disappears instantly.

- [ ] **Step 6: Commit**

```bash
git add app/particulars/QuickAddRow.tsx app/particulars/page.tsx
git commit -m "feat(particulars): optimistic quick-add and delete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: ParticularForm — optimistic create & update, close dialog on submit

**Files:**
- Modify: `app/particulars/ParticularForm.tsx:58-67`

**Interfaces:**
- Consumes: `addRow`, `updateRow`, `newTempId` from `lib/optimistic.ts`.
- Produces: nothing downstream.

The dialog closes immediately on submit (deterministic). On error the list row
rolls back and a toast fires; the dialog does not re-open (acceptable per spec).

- [ ] **Step 1: Rewrite the mutation wiring**

In `app/particulars/ParticularForm.tsx` add the import:

```tsx
import { addRow, updateRow, newTempId } from "@/lib/optimistic";
```

Replace lines 58-67 (`const onDone` through the `submit` definition) with:

```tsx
  const key = { accountId: accountId! };
  const onMutationError = (error: { message: string }, _vars: unknown, ctx?: { prev: unknown }) => {
    if (ctx) utils.particular.list.setData(key, ctx.prev as never);
    toast.error(particularId ? "Couldn't save changes" : "Couldn't add item", { description: error.message });
  };
  const onSettled = () => { utils.particular.list.invalidate(); utils.forecast.getData.invalidate(); };

  const create = trpc.particular.create.useMutation({
    onMutate: async (vars) => {
      await utils.particular.list.cancel(key);
      const prev = utils.particular.list.getData(key);
      utils.particular.list.setData(key, (old) =>
        addRow(old, {
          id: newTempId(),
          name: vars.name, type: vars.type, amount: vars.amount, frequency: vars.frequency,
          startDate: vars.startDate as Date, endDate: (vars.endDate as Date | undefined) ?? null,
          isCritical: vars.isCritical, isFixed: vars.isFixed,
          businessDayAdjustment: vars.businessDayAdjustment, category: vars.category ?? null,
        } as never),
      );
      return { prev };
    },
    onError: onMutationError,
    onSettled,
  });
  const update = trpc.particular.update.useMutation({
    onMutate: async (vars) => {
      await utils.particular.list.cancel(key);
      const prev = utils.particular.list.getData(key);
      utils.particular.list.setData(key, (old) =>
        updateRow(old, vars.id, {
          name: vars.name, type: vars.type, amount: vars.amount, frequency: vars.frequency,
          startDate: vars.startDate as Date, endDate: (vars.endDate as Date | undefined) ?? null,
          isCritical: vars.isCritical, isFixed: vars.isFixed,
          businessDayAdjustment: vars.businessDayAdjustment, category: vars.category ?? null,
        } as never),
      );
      return { prev };
    },
    onError: onMutationError,
    onSettled,
  });

  const submit = form.handleSubmit((values) => {
    if (particularId) update.mutate({ accountId: accountId!, ...values, id: particularId });
    else create.mutate({ accountId: accountId!, ...values });
    onClose();
  });
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

On the running app: open "Add item", fill it, Save — the dialog closes
immediately and the row appears (pulsing) in the right section. Edit an existing
item, change the amount, Save — the dialog closes and the row updates instantly.

- [ ] **Step 4: Commit**

```bash
git add app/particulars/ParticularForm.tsx
git commit -m "feat(particulars): optimistic create/update in item dialog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Category changes — CategoryPill & Spending retag (optimistic update)

**Files:**
- Modify: `app/particulars/CategoryPill.tsx:22-28`
- Modify: `app/spending/page.tsx:26-32`

**Interfaces:**
- Consumes: `updateRow` from `lib/optimistic.ts`.
- Produces: nothing downstream.

Both patch `particular.list` by setting the row's `category`. Spending also
invalidates `category.list` on settle (preserve that).

- [ ] **Step 1: CategoryPill — optimistic category update**

In `app/particulars/CategoryPill.tsx` add the import:

```tsx
import { updateRow } from "@/lib/optimistic";
```

Replace the `update` mutation (lines 22-28) with:

```tsx
  const update = trpc.particular.update.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId };
      await utils.particular.list.cancel(key);
      const prev = utils.particular.list.getData(key);
      utils.particular.list.setData(key, (old) =>
        updateRow(old, vars.id, { category: vars.category ?? null } as never),
      );
      return { prev, key };
    },
    onError: (error, _vars, ctx) => {
      if (ctx) utils.particular.list.setData(ctx.key, ctx.prev);
      toast.error("Couldn't save category", { description: error.message });
    },
    onSettled: () => {
      utils.particular.list.invalidate();
      utils.forecast.getData.invalidate();
    },
  });
```

- [ ] **Step 2: Spending page — optimistic retag**

In `app/spending/page.tsx` add the import:

```tsx
import { updateRow } from "@/lib/optimistic";
```

Replace the `update` mutation (lines 26-32) with:

```tsx
  const update = trpc.particular.update.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId };
      await utils.particular.list.cancel(key);
      const prev = utils.particular.list.getData(key);
      utils.particular.list.setData(key, (old) =>
        updateRow(old, vars.id, { category: vars.category ?? null } as never),
      );
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) utils.particular.list.setData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      utils.particular.list.invalidate();
      utils.category.list.invalidate();
      utils.forecast.getData.invalidate();
    },
  });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual verification**

On the running app: on Items, change an expense's category via the
pill — the pill reflects the new value instantly. On Spending, expand a group and
retag an item — the chip updates instantly (group totals reconcile on settle).

- [ ] **Step 5: Commit**

```bash
git add app/particulars/CategoryPill.tsx app/spending/page.tsx
git commit -m "feat(categories): optimistic category retag

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Overrides — optimistic upsert & revert (OverrideModal, OverrideManagement)

**Files:**
- Modify: `app/_components/dashboard/OverrideModal.tsx:23-25`
- Modify: `app/particulars/OverrideManagement.tsx:16-18`, `:24` (pending row style)

**Interfaces:**
- Consumes: `upsertRowBy`, `removeRow`, `newTempId`, `isTempId` from `lib/optimistic.ts`.
- Produces: nothing downstream.

`particular.listOverrides` is keyed `{ accountId, particularId }`. An override row
has `{ id, originalDate, overriddenAmount, overriddenDate, isSkipped }`.
`overrideInstance` is an upsert keyed by `originalDate` — match an existing
override with the same `originalDate` (compare via `getTime()`) else add.

- [ ] **Step 1: OverrideModal — optimistic upsert + revert**

In `app/_components/dashboard/OverrideModal.tsx` add the import:

```tsx
import { upsertRowBy, removeRow, newTempId } from "@/lib/optimistic";
```

Replace lines 23-25 (`const onSuccess` and the two mutations) with:

```tsx
  const settle = () => { utils.forecast.getData.invalidate(); utils.particular.listOverrides.invalidate({ accountId: accountId!, particularId }); };
  const override = trpc.particular.overrideInstance.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: accountId!, particularId };
      await utils.particular.listOverrides.cancel(key);
      const prev = utils.particular.listOverrides.getData(key);
      const origTime = new Date(vars.originalDate).getTime();
      utils.particular.listOverrides.setData(key, (old) =>
        upsertRowBy(
          old,
          (r) => new Date(r.originalDate).getTime() === origTime,
          {
            id: newTempId(),
            originalDate: vars.originalDate,
            overriddenAmount: vars.overriddenAmount ?? null,
            overriddenDate: vars.overriddenDate ?? null,
            isSkipped: vars.isSkipped ?? false,
          } as never,
        ),
      );
      onClose();
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.particular.listOverrides.setData(ctx.key, ctx.prev); },
    onSettled: settle,
  });
  const revert = trpc.particular.deleteOverride.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: accountId!, particularId };
      await utils.particular.listOverrides.cancel(key);
      const prev = utils.particular.listOverrides.getData(key);
      utils.particular.listOverrides.setData(key, (old) => removeRow(old, vars.id));
      onClose();
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.particular.listOverrides.setData(ctx.key, ctx.prev); },
    onSettled: settle,
  });
```

Note: `onClose()` now fires in `onMutate` (deterministic close) rather than on
success. The override list this modal lives over (on the dashboard) is the
forecast, which reconciles on settle.

- [ ] **Step 2: OverrideManagement — optimistic revert + pending style**

In `app/particulars/OverrideManagement.tsx` add the import:

```tsx
import { removeRow, isTempId } from "@/lib/optimistic";
```

Replace the `del` mutation (lines 16-18) with:

```tsx
  const del = trpc.particular.deleteOverride.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId, particularId };
      await utils.particular.listOverrides.cancel(key);
      const prev = utils.particular.listOverrides.getData(key);
      utils.particular.listOverrides.setData(key, (old) => removeRow(old, vars.id));
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.particular.listOverrides.setData(ctx.key, ctx.prev); },
    onSettled: () => { utils.particular.listOverrides.invalidate({ accountId: accountId!, particularId }); utils.forecast.getData.invalidate(); },
  });
```

Then add the pending style to the override row (line 24). Replace:

```tsx
        <div key={o.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
```

with:

```tsx
        <div key={o.id} className={`flex items-center justify-between rounded-md border p-2 text-sm${isTempId(o.id) ? " opacity-60 animate-pulse" : ""}`}>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual verification**

On the running app: open an override modal from a dashboard transaction, set a
new amount/date or skip, Save — the modal closes immediately and the forecast
reconciles shortly after. On Items, expand an item with overrides and
Revert one — it disappears from the list instantly.

- [ ] **Step 5: Commit**

```bash
git add app/_components/dashboard/OverrideModal.tsx app/particulars/OverrideManagement.tsx
git commit -m "feat(overrides): optimistic override upsert and revert

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard balance — optimistic update

**Files:**
- Modify: `app/page.tsx:42-44`

**Interfaces:**
- Consumes: `updateRow` from `lib/optimistic.ts`.
- Produces: nothing downstream.

`account.list` takes no input; items use `currentBalance` (number). Patch the
active account's `currentBalance`. The displayed "Current Balance" metric is
derived from the *forecast* (`result.days[0].openingBalance`), which reconciles
on settle; patching `account.list` keeps the account picker / context consistent
immediately and is the right cache to touch.

- [ ] **Step 1: Make `updateBalance` optimistic**

In `app/page.tsx` add the import:

```tsx
import { updateRow } from "@/lib/optimistic";
```

Replace lines 42-44 (`const updateBalance = …`) with:

```tsx
  const updateBalance = trpc.account.updateBalance.useMutation({
    onMutate: async (vars) => {
      await utils.account.list.cancel();
      const prev = utils.account.list.getData();
      utils.account.list.setData(undefined, (old) =>
        updateRow(old, vars.accountId, { currentBalance: vars.balance } as never),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.account.list.setData(undefined, ctx.prev); },
    onSettled: () => { utils.account.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

On the running app (Dashboard): edit the Current Balance metric, save — the
account context updates immediately and the forecast/metrics reconcile a beat
later.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(dashboard): optimistic balance update

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 2: Run the test suite**

Run: `npx vitest run`
Expected: PASS — all existing server/lib tests plus the new
`lib/optimistic.test.ts` (8 tests). Confirms no import breakage.

- [ ] **Step 3: Manual smoke of each surface**

On the running app, confirm instant update (then settle) for each:
holiday add/delete · quick-add item · add/edit item via dialog · delete item ·
category pill change · spending retag · override save/revert · balance edit.
For one of them (e.g. holiday add), throttle the network in devtools and confirm
the row appears before the request completes.

- [ ] **Step 4: Final commit (if any stray changes)**

```bash
git add -A
git commit -m "chore: optimistic updates verification sweep" || echo "nothing to commit"
```
```
