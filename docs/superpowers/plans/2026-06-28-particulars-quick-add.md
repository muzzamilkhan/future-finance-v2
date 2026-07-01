# Particulars Quick-Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline quick-add row to the Items page and make a blank end date reliably mean "no end date".

**Architecture:** Fix the shared `particularInput` Zod schema so empty end-date values normalize to `undefined` (fixing a latent 1970-coercion bug that affects both the existing modal and the new row). Add a `QuickAddRow` client component that submits via the existing `particular.create` tRPC mutation with the modal's defaults, and render it below the list. The edit modal is unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, tRPC 11, Zod 4, react-hook-form, Vitest.

## Global Constraints

- Test runner is Vitest. No `@testing-library` is installed — do not add a component-test stack.
- Keep `lib/schemas/` free of React/Prisma/Next imports.
- `Particular.amount` is stored positive; sign comes from `type`.
- Quick-add hidden-field defaults must match the modal: `frequency: "MONTHLY"`, `isCritical: true`, `isFixed: true`, `businessDayAdjustment: "NONE"`, `endDate: undefined`.
- Spec: `docs/superpowers/specs/2026-06-28-particulars-quick-add-design.md`.

---

### Task 1: Empty end-date normalizes to undefined (schema fix)

**Files:**
- Modify: `lib/schemas/particular.ts:13`
- Test: `lib/schemas/particular.test.ts`

**Interfaces:**
- Produces: `particularInput` unchanged in shape; `endDate` now accepts `""`, `null`, and `undefined`, all parsing to `undefined`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/schemas/particular.test.ts` inside the `describe("particularInput", …)` block:

```ts
  it.each([["", "empty string"], [null, "null"], [undefined, "undefined"]])(
    "treats %s endDate (%s) as no end date",
    (endDate) => {
      const r = particularInput.safeParse({
        name: "Rent", type: "EXPENSE", amount: 1500, frequency: "MONTHLY",
        startDate: new Date("2026-06-28"), endDate,
        isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.endDate).toBeUndefined();
    },
  );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/particular.test.ts`
Expected: FAIL — the `""` and `null` cases fail (`null` parses to a 1970 Date, `""` errors), so `endDate` is not `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `lib/schemas/particular.ts`, replace the `endDate` line (currently `endDate: z.coerce.date().optional(),`) with a preprocess that normalizes empty values. Add the helper just above the `particularInput` declaration:

```ts
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
```

and change the field to:

```ts
  endDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/schemas/particular.test.ts`
Expected: PASS — all cases including the existing refine tests.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/particular.ts lib/schemas/particular.test.ts
git commit -m "fix(schemas): blank endDate normalizes to undefined, not 1970"
```

---

### Task 2: QuickAddRow component + page wiring

**Files:**
- Create: `app/particulars/QuickAddRow.tsx`
- Modify: `app/particulars/page.tsx:8` (import), `app/particulars/page.tsx:51` (render below list)

**Interfaces:**
- Consumes: `particularInput` from `@/lib/schemas`; `trpc` from `@/trpc/client`; `Button`, `Input`, `Select*` from `@/app/_components/ui/*`.
- Produces: `export function QuickAddRow(): JSX.Element` — a self-contained row needing no props.

- [ ] **Step 1: Create the component**

Create `app/particulars/QuickAddRow.tsx`:

```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { particularInput } from "@/lib/schemas";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/app/_components/ui/select";

type QuickAddValues = z.input<typeof particularInput>;

const defaults = (): QuickAddValues => ({
  name: "",
  type: "EXPENSE",
  amount: 0,
  frequency: "MONTHLY",
  startDate: new Date(),
  isCritical: true,
  isFixed: true,
  businessDayAdjustment: "NONE",
});

export function QuickAddRow() {
  const utils = trpc.useUtils();
  const form = useForm<QuickAddValues>({
    resolver: zodResolver(particularInput),
    defaultValues: defaults(),
  });

  const create = trpc.particular.create.useMutation({
    onSuccess: () => {
      utils.particular.list.invalidate();
      utils.forecast.getData.invalidate();
      form.reset(defaults());
    },
  });

  const submit = form.handleSubmit((values) => create.mutate(values));

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-start gap-2 rounded-md border border-dashed p-3"
    >
      <div className="flex-1 min-w-[8rem]">
        <Input placeholder="Name" {...form.register("name")} />
        {form.formState.errors.name && (
          <p className="mt-1 text-xs text-destructive">Name is required</p>
        )}
      </div>
      <Select
        value={form.watch("type")}
        onValueChange={(v) => form.setValue("type", v as "INCOME" | "EXPENSE")}
      >
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="INCOME">Income</SelectItem>
          <SelectItem value="EXPENSE">Expense</SelectItem>
        </SelectContent>
      </Select>
      <div className="w-28">
        <Input
          type="number"
          step="0.01"
          placeholder="Amount"
          {...form.register("amount", { valueAsNumber: true })}
        />
        {form.formState.errors.amount && (
          <p className="mt-1 text-xs text-destructive">Amount must be positive</p>
        )}
      </div>
      <Input type="date" className="w-40" {...form.register("startDate", { valueAsDate: true })} />
      <Button type="submit" disabled={create.isPending}>Add</Button>
    </form>
  );
}
```

- [ ] **Step 2: Wire it into the page**

In `app/particulars/page.tsx`, add the import after the `OverrideManagement` import (line 9):

```tsx
import { QuickAddRow } from "./QuickAddRow";
```

Then render it directly after the list's closing block. Replace this section (around lines 51–52):

```tsx
          </div>
        )}
```

with:

```tsx
          </div>
        )}
        <QuickAddRow />
```

- [ ] **Step 3: Verify type-check and build pass**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors. `QuickAddValues` lines up with the `create` mutation input.

- [ ] **Step 4: Manual UI verification**

Per project memory, the dev server is run by the implementer on a free port (`next dev -p <free port>`). With it running, open `/particulars` and confirm:
- The dashed quick-add row appears below the list.
- Adding with a name + amount + date creates the item (it appears in the list with the right sign/colour) and the row resets, date back to today.
- Submitting with an empty name or zero amount shows the inline error and does not create.
- The created item, when opened in the edit modal, has no end date.

- [ ] **Step 5: Commit**

```bash
git add app/particulars/QuickAddRow.tsx app/particulars/page.tsx
git commit -m "feat(particulars): inline quick-add row below the list"
```

---

## Self-Review

- **Spec coverage:** Schema fix → Task 1. QuickAddRow with minimal inputs + modal defaults + reset → Task 2 Step 1. Page wiring (additive, modal unchanged) → Task 2 Step 2. Schema Vitest cases → Task 1. Manual UI verification (no component test stack) → Task 2 Step 4. All spec sections covered.
- **Placeholder scan:** No TBD/TODO; all code shown in full.
- **Type consistency:** `QuickAddValues = z.input<typeof particularInput>` matches the modal's pattern and the `create.mutate` input; `defaults()` returns that exact type; `type`/`businessDayAdjustment` literals match the Zod enums.
