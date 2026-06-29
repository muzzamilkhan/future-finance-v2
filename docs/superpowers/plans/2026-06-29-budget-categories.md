# Budget & Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Budget section where each expense can be tagged to a per-user category, visualized as a monthly-spend donut with a Surplus slice or Deficit callout.

**Architecture:** A pure `lib/budget/` module (category normalization + monthly-equivalent budget summary, no React/Prisma/Next imports) is the tested heart. Prisma gains `User.categories` (comma-sep derived cache) and `Particular.category` (nullable name). The particular router normalizes categories on save and re-syncs the user's category list after every expense mutation; a new `category` router exposes the list. A `/budget` client page renders the donut (recharts) and an inline-retag legend; nav gains a Budget item.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Vitest · tRPC 11 · Prisma 7 · recharts 3 · Tailwind v4 · Zod 4 · date-fns.

## Global Constraints

- `Particular.amount` is stored **positive**; sign applied from `type` (INCOME +, EXPENSE −) inside engine/budget code — copied verbatim from spec.
- Keep `lib/budget/` and `lib/schemas/` free of React/Prisma/Next imports.
- Categories apply to **EXPENSE** particulars only; income ignores `category`.
- `User.categories` is a **derived cache**: rewritten from the actual set of categories referenced by the user's expenses after every expense mutation.
- Normalization: trim, collapse internal whitespace to single spaces, title-case each word; blank → `null`/`""`.
- Currency: NZD via existing `formatCurrency` (`lib/design-system.ts`).
- Test runner is **Vitest**. Router tests mock `../db` and `../auth` and test **pure exported functions only** (see `server/routers/particular.test.ts`) — do not spin up a real DB.
- Commit one task per commit. Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Category normalization helpers

**Files:**
- Create: `lib/budget/category.ts`
- Test: `lib/budget/category.test.ts`

**Interfaces:**
- Produces:
  - `normalizeCategory(raw: string): string` — trim, collapse whitespace, title-case; blank → `""`.
  - `parseCategories(csv: string): string[]` — split on `,`, normalize each, drop blanks, dedupe case-insensitively, sort alphabetically (case-insensitive).
  - `serializeCategories(names: string[]): string` — normalize/dedupe/sort then join with `,`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/budget/category.test.ts
import { describe, it, expect } from "vitest";
import { normalizeCategory, parseCategories, serializeCategories } from "./category";

describe("normalizeCategory", () => {
  it("trims, collapses whitespace, title-cases", () => {
    expect(normalizeCategory("  groceries  ")).toBe("Groceries");
    expect(normalizeCategory("home   loan")).toBe("Home Loan");
    expect(normalizeCategory("EATING out")).toBe("Eating Out");
  });
  it("returns empty string for blank", () => {
    expect(normalizeCategory("   ")).toBe("");
    expect(normalizeCategory("")).toBe("");
  });
});

describe("parseCategories", () => {
  it("splits, normalizes, drops blanks, dedupes case-insensitively, sorts", () => {
    expect(parseCategories("groceries, Travel ,, GROCERIES, bills")).toEqual([
      "Bills", "Groceries", "Travel",
    ]);
  });
  it("returns [] for empty input", () => {
    expect(parseCategories("")).toEqual([]);
  });
});

describe("serializeCategories", () => {
  it("normalizes, dedupes, sorts, joins with comma", () => {
    expect(serializeCategories(["Travel", "bills", "Bills"])).toBe("Bills,Travel");
  });
  it("returns empty string for no names", () => {
    expect(serializeCategories([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/budget/category.test.ts`
Expected: FAIL — cannot resolve `./category`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/budget/category.ts
export function normalizeCategory(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed === "") return "";
  return collapsed
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function parseCategories(csv: string): string[] {
  const seen = new Map<string, string>(); // lowercase -> display
  for (const part of csv.split(",")) {
    const name = normalizeCategory(part);
    if (name === "") continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function serializeCategories(names: string[]): string {
  return parseCategories(names.join(",")).join(",");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/budget/category.test.ts`
Expected: PASS (3 suites).

- [ ] **Step 5: Commit**

```bash
git add lib/budget/category.ts lib/budget/category.test.ts
git commit -m "feat(budget): category normalization helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Budget engine (toMonthly + buildBudget)

**Files:**
- Create: `lib/budget/budget.ts`
- Test: `lib/budget/budget.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  - `type RecurrenceFrequency = "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL";`
  - `type ParticularType = "INCOME" | "EXPENSE";`
  - `type BudgetParticular = { type: ParticularType; amount: number; frequency: RecurrenceFrequency; category?: string | null };`
  - `type BudgetCategory = { name: string; monthly: number };`
  - `type BudgetSummary = { categories: BudgetCategory[]; untagged: number; totalExpense: number; monthlyIncome: number; surplus: number };`
  - `toMonthly(amount: number, frequency: RecurrenceFrequency): number`
  - `buildBudget(particulars: BudgetParticular[]): BudgetSummary`

Notes for the implementer:
- `toMonthly` uses `Math.abs(amount)` semantics indirectly — callers pass the stored positive amount; `toMonthly` itself just multiplies. `buildBudget` applies `Math.abs`.
- `categories` sorted by `monthly` descending; ties broken by `name` ascending.
- ONCE_OFF contributes 0 to everything.
- `surplus = monthlyIncome - totalExpense` (negative = deficit).

- [ ] **Step 1: Write the failing test**

```ts
// lib/budget/budget.test.ts
import { describe, it, expect } from "vitest";
import { toMonthly, buildBudget } from "./budget";

describe("toMonthly", () => {
  it("converts each frequency to a monthly-equivalent", () => {
    expect(toMonthly(120, "MONTHLY")).toBe(120);
    expect(toMonthly(1200, "ANNUAL")).toBe(100);
    expect(toMonthly(100, "WEEKLY")).toBeCloseTo(100 * 52 / 12);
    expect(toMonthly(100, "FORTNIGHTLY")).toBeCloseTo(100 * 26 / 12);
    expect(toMonthly(500, "ONCE_OFF")).toBe(0);
  });
});

describe("buildBudget", () => {
  it("groups expenses by category, computes untagged, totals, and surplus", () => {
    const s = buildBudget([
      { type: "INCOME", amount: 5000, frequency: "MONTHLY" },
      { type: "EXPENSE", amount: 1200, frequency: "MONTHLY", category: "Rent" },
      { type: "EXPENSE", amount: 600, frequency: "MONTHLY", category: "Groceries" },
      { type: "EXPENSE", amount: 200, frequency: "MONTHLY", category: null },
    ]);
    expect(s.categories).toEqual([
      { name: "Rent", monthly: 1200 },
      { name: "Groceries", monthly: 600 },
    ]);
    expect(s.untagged).toBe(200);
    expect(s.totalExpense).toBe(2000);
    expect(s.monthlyIncome).toBe(5000);
    expect(s.surplus).toBe(3000);
  });

  it("aggregates multiple expenses sharing a category and normalizes frequency", () => {
    const s = buildBudget([
      { type: "EXPENSE", amount: 1200, frequency: "ANNUAL", category: "Insurance" }, // 100/mo
      { type: "EXPENSE", amount: 50, frequency: "WEEKLY", category: "Insurance" },   // 216.67/mo
    ]);
    expect(s.categories[0].name).toBe("Insurance");
    expect(s.categories[0].monthly).toBeCloseTo(100 + 50 * 52 / 12);
  });

  it("reports a negative surplus (deficit) when expenses exceed income", () => {
    const s = buildBudget([
      { type: "INCOME", amount: 1000, frequency: "MONTHLY" },
      { type: "EXPENSE", amount: 1500, frequency: "MONTHLY", category: "Rent" },
    ]);
    expect(s.surplus).toBe(-500);
  });

  it("excludes once-offs and handles empty input", () => {
    expect(buildBudget([])).toEqual({
      categories: [], untagged: 0, totalExpense: 0, monthlyIncome: 0, surplus: 0,
    });
    const s = buildBudget([
      { type: "EXPENSE", amount: 999, frequency: "ONCE_OFF", category: "Holiday" },
    ]);
    expect(s.totalExpense).toBe(0);
    expect(s.categories).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/budget/budget.test.ts`
Expected: FAIL — cannot resolve `./budget`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/budget/budget.ts
export type RecurrenceFrequency =
  | "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL";
export type ParticularType = "INCOME" | "EXPENSE";

export type BudgetParticular = {
  type: ParticularType;
  amount: number;
  frequency: RecurrenceFrequency;
  category?: string | null;
};

export type BudgetCategory = { name: string; monthly: number };
export type BudgetSummary = {
  categories: BudgetCategory[];
  untagged: number;
  totalExpense: number;
  monthlyIncome: number;
  surplus: number;
};

export function toMonthly(amount: number, frequency: RecurrenceFrequency): number {
  switch (frequency) {
    case "WEEKLY": return amount * 52 / 12;
    case "FORTNIGHTLY": return amount * 26 / 12;
    case "MONTHLY": return amount;
    case "ANNUAL": return amount / 12;
    case "ONCE_OFF": return 0;
  }
}

export function buildBudget(particulars: BudgetParticular[]): BudgetSummary {
  const byCategory = new Map<string, number>();
  let untagged = 0;
  let totalExpense = 0;
  let monthlyIncome = 0;

  for (const p of particulars) {
    const monthly = toMonthly(Math.abs(p.amount), p.frequency);
    if (monthly === 0) continue;
    if (p.type === "INCOME") {
      monthlyIncome += monthly;
      continue;
    }
    totalExpense += monthly;
    const name = p.category ?? "";
    if (name === "") {
      untagged += monthly;
    } else {
      byCategory.set(name, (byCategory.get(name) ?? 0) + monthly);
    }
  }

  const categories = [...byCategory.entries()]
    .map(([name, monthly]) => ({ name, monthly }))
    .sort((a, b) => b.monthly - a.monthly || a.name.localeCompare(b.name));

  return {
    categories,
    untagged,
    totalExpense,
    monthlyIncome,
    surplus: monthlyIncome - totalExpense,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/budget/budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/budget/budget.ts lib/budget/budget.test.ts
git commit -m "feat(budget): monthly-equivalent budget engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Prisma schema — categories columns

**Files:**
- Modify: `prisma/schema.prisma` (User model + Particular model)

**Interfaces:**
- Produces: `User.categories: String` (default `""`); `Particular.category: String?`.

- [ ] **Step 1: Add the columns**

In `model User`, add after `financeAccount`:

```prisma
  categories    String          @default("")
```

In `model Particular`, add after `name`:

```prisma
  category              String?
```

- [ ] **Step 2: Push the schema to the dev DB and regenerate the client**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema" and the client regenerates (`Generated Prisma Client`).

- [ ] **Step 3: Typecheck to confirm the generated client picked up the fields**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(budget): add User.categories and Particular.category columns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Schema — category on particular input

**Files:**
- Modify: `lib/schemas/particular.ts`

**Interfaces:**
- Consumes: `normalizeCategory` from `lib/budget/category.ts` (Task 1).
- Produces: `particularInput` now accepts optional `category` (string | undefined). `ParticularInput["category"]` is `string | undefined`.

Note: We normalize the value at the boundary via Zod `transform` so the router and tests both get a clean value; blank/whitespace → `undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/schemas/particular.test.ts — ADD to the existing file (create if absent)
import { describe, it, expect } from "vitest";
import { particularInput } from "./particular";

describe("particularInput category", () => {
  const base = { name: "Power", type: "EXPENSE", amount: 100, frequency: "MONTHLY", startDate: "2026-06-01" };
  it("normalizes a provided category", () => {
    const parsed = particularInput.parse({ ...base, category: "  power  bills " });
    expect(parsed.category).toBe("Power Bills");
  });
  it("treats blank category as undefined", () => {
    const parsed = particularInput.parse({ ...base, category: "   " });
    expect(parsed.category).toBeUndefined();
  });
  it("allows omitting category", () => {
    const parsed = particularInput.parse(base);
    expect(parsed.category).toBeUndefined();
  });
});
```

(If `lib/schemas/particular.test.ts` already exists, append the `describe` block and reuse its imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/particular.test.ts`
Expected: FAIL — `category` is stripped/undefined unexpectedly or assertion fails.

- [ ] **Step 3: Add the field to the schema**

In `lib/schemas/particular.ts`, add the import at top:

```ts
import { normalizeCategory } from "@/lib/budget/category";
```

Add inside the `z.object({ ... })` (before the closing `})` that precedes `.refine`):

```ts
  category: z.preprocess(
    emptyToUndefined,
    z.string().transform((s) => normalizeCategory(s)).optional(),
  ).transform((v) => (v === "" ? undefined : v)),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/schemas/particular.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/particular.ts lib/schemas/particular.test.ts
git commit -m "feat(budget): accept normalized category on particular input

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: User-category sync helper (pure)

**Files:**
- Create: `server/categorySync.ts`
- Test: `server/categorySync.test.ts`

**Interfaces:**
- Consumes: `serializeCategories` from `lib/budget/category.ts` (Task 1).
- Produces:
  - `computeUserCategories(expenseCategories: (string | null)[]): string` — given the categories of a user's expenses, returns the serialized comma-sep list (dropping nulls/blanks, deduped/sorted). This is the **pure, testable** core.
  - `syncUserCategories(prisma, userId, accountId): Promise<void>` — queries the account's expense particulars, calls `computeUserCategories`, writes `User.categories`. Thin DB wrapper; not unit-tested (DB-bound), used by the router.

- [ ] **Step 1: Write the failing test**

```ts
// server/categorySync.test.ts
import { describe, it, expect } from "vitest";
import { computeUserCategories } from "./categorySync";

describe("computeUserCategories", () => {
  it("serializes distinct non-null expense categories, sorted", () => {
    expect(computeUserCategories(["Rent", "Groceries", "Rent", null])).toBe("Groceries,Rent");
  });
  it("drops nulls and blanks; returns empty string when none", () => {
    expect(computeUserCategories([null, "", "  "])).toBe("");
    expect(computeUserCategories([])).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/categorySync.test.ts`
Expected: FAIL — cannot resolve `./categorySync`.

- [ ] **Step 3: Write the implementation**

```ts
// server/categorySync.ts
import type { PrismaClient } from "@prisma/client";
import { serializeCategories } from "@/lib/budget/category";

export function computeUserCategories(expenseCategories: (string | null)[]): string {
  return serializeCategories(
    expenseCategories.filter((c): c is string => !!c && c.trim() !== ""),
  );
}

export async function syncUserCategories(
  prisma: PrismaClient,
  userId: string,
  accountId: string,
): Promise<void> {
  const expenses = await prisma.particular.findMany({
    where: { accountId, type: "EXPENSE" },
    select: { category: true },
  });
  const categories = computeUserCategories(expenses.map((e) => e.category));
  await prisma.user.update({ where: { id: userId }, data: { categories } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/categorySync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/categorySync.ts server/categorySync.test.ts
git commit -m "feat(budget): user-category sync helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Wire sync into the particular router + add category router

**Files:**
- Modify: `server/routers/particular.ts`
- Create: `server/routers/category.ts`
- Modify: `server/routers/_app.ts`

**Interfaces:**
- Consumes: `syncUserCategories` (Task 5); `parseCategories` (Task 1).
- Produces: `category.list` tRPC query returning `string[]`. Particular create/update/delete now call `syncUserCategories` after the write.

- [ ] **Step 1: Call sync after each particular mutation**

In `server/routers/particular.ts`, add the import:

```ts
import { syncUserCategories } from "../categorySync";
```

Wrap the three mutations so each awaits the write, then syncs, then returns. Replace the `create` body:

```ts
  create: protectedProcedure.input(particularInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    const created = await ctx.prisma.particular.create({ data: { ...input, accountId: a.id } });
    await syncUserCategories(ctx.prisma, ctx.user.id, a.id);
    return created;
  }),
```

Replace the `update` body's final `return`:

```ts
      const updated = await ctx.prisma.particular.update({ where: { id }, data });
      await syncUserCategories(ctx.prisma, ctx.user.id, a.id);
      return updated;
```

Replace the `delete` body:

```ts
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    const result = await ctx.prisma.particular.deleteMany({ where: { id: input.id, accountId: a.id } });
    await syncUserCategories(ctx.prisma, ctx.user.id, a.id);
    return result;
  }),
```

- [ ] **Step 2: Create the category router**

```ts
// server/routers/category.ts
import { router, protectedProcedure } from "../trpc";
import { parseCategories } from "@/lib/budget/category";

export const categoryRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { categories: true },
    });
    return parseCategories(user?.categories ?? "");
  }),
});
```

- [ ] **Step 3: Mount the router**

In `server/routers/_app.ts`, add:

```ts
import { categoryRouter } from "./category";
```

and add `category: categoryRouter,` to the `router({ ... })` object.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (all suites, including the existing `particular.test.ts` pure tests).

- [ ] **Step 6: Commit**

```bash
git add server/routers/particular.ts server/routers/category.ts server/routers/_app.ts
git commit -m "feat(budget): sync user categories on mutation + category.list router

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Category combobox in the particular form

**Files:**
- Modify: `app/particulars/ParticularForm.tsx`

**Interfaces:**
- Consumes: `category.list` query (Task 6).
- Produces: form now sends `category` for expenses.

- [ ] **Step 1: Add the category field to default/values and a datalist input**

At the top of `ParticularForm`, after the `existing` query, add:

```ts
  const { data: categoryOptions = [] } = trpc.category.list.useQuery();
```

Add `category` to BOTH `defaultValues` and the `values` object:

```ts
      category: existing?.category ?? "",
```

(in `defaultValues`, after `businessDayAdjustment`), and in `values` (after `businessDayAdjustment`):

```ts
          category: existing.category ?? "",
```

Add the field in the JSX, immediately after the Amount block and gated on type === EXPENSE:

```tsx
          {form.watch("type") === "EXPENSE" && (
            <div className="space-y-1">
              <Label>Category</Label>
              <Input
                list="category-options"
                placeholder="e.g. Groceries"
                {...form.register("category")}
              />
              <datalist id="category-options">
                {categoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          )}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (`particularInput` accepts `category`; `z.input` includes it as optional.)

- [ ] **Step 3: Manual smoke (build-level) — run the suite to ensure nothing breaks**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/particulars/ParticularForm.tsx
git commit -m "feat(budget): category combobox in particular form (expenses only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Budget donut chart component

**Files:**
- Create: `app/budget/BudgetChart.tsx`
- Test: `app/budget/budgetChartData.test.ts`
- Create: `app/budget/budgetChartData.ts`

**Interfaces:**
- Consumes: `BudgetSummary`, `BudgetCategory` from `lib/budget/budget.ts` (Task 2).
- Produces:
  - `toPieData(summary: BudgetSummary): { name: string; value: number; kind: "category" | "untagged" | "surplus" }[]` — pure, tested. Includes a `Surplus` entry only when `surplus > 0`; includes `Untagged` only when `untagged > 0`. Never includes a slice for a deficit.
  - `BudgetChart({ summary }: { summary: BudgetSummary })` — renders a recharts donut + center total + deficit banner.

- [ ] **Step 1: Write the failing test for the pure data shaper**

```ts
// app/budget/budgetChartData.test.ts
import { describe, it, expect } from "vitest";
import { toPieData } from "./budgetChartData";
import type { BudgetSummary } from "@/lib/budget/budget";

const base: BudgetSummary = {
  categories: [{ name: "Rent", monthly: 1200 }, { name: "Food", monthly: 600 }],
  untagged: 0, totalExpense: 1800, monthlyIncome: 3000, surplus: 1200,
};

describe("toPieData", () => {
  it("adds a surplus slice when income exceeds expenses", () => {
    const d = toPieData(base);
    expect(d).toContainEqual({ name: "Surplus", value: 1200, kind: "surplus" });
    expect(d.filter((x) => x.kind === "category")).toHaveLength(2);
  });
  it("adds an untagged slice only when untagged > 0", () => {
    expect(toPieData(base).some((x) => x.kind === "untagged")).toBe(false);
    const d = toPieData({ ...base, untagged: 100, totalExpense: 1900 });
    expect(d).toContainEqual({ name: "Untagged", value: 100, kind: "untagged" });
  });
  it("never adds a surplus slice on a deficit", () => {
    const d = toPieData({ ...base, monthlyIncome: 1000, surplus: -800 });
    expect(d.some((x) => x.kind === "surplus")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/budget/budgetChartData.test.ts`
Expected: FAIL — cannot resolve `./budgetChartData`.

- [ ] **Step 3: Implement the pure shaper**

```ts
// app/budget/budgetChartData.ts
import type { BudgetSummary } from "@/lib/budget/budget";

export type PieDatum = {
  name: string;
  value: number;
  kind: "category" | "untagged" | "surplus";
};

export function toPieData(summary: BudgetSummary): PieDatum[] {
  const data: PieDatum[] = summary.categories.map((c) => ({
    name: c.name, value: c.monthly, kind: "category",
  }));
  if (summary.untagged > 0) {
    data.push({ name: "Untagged", value: summary.untagged, kind: "untagged" });
  }
  if (summary.surplus > 0) {
    data.push({ name: "Surplus", value: summary.surplus, kind: "surplus" });
  }
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/budget/budgetChartData.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the chart component**

```tsx
// app/budget/BudgetChart.tsx
"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { BudgetSummary } from "@/lib/budget/budget";
import { toPieData, type PieDatum } from "./budgetChartData";
import { formatCurrency } from "@/lib/design-system";

const CATEGORY_COLORS = [
  "#2563eb", "#16a34a", "#db2777", "#d97706", "#7c3aed",
  "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#059669",
];
const UNTAGGED_COLOR = "#94a3b8";
const SURPLUS_COLOR = "#22c55e";

function colorFor(d: PieDatum, i: number): string {
  if (d.kind === "surplus") return SURPLUS_COLOR;
  if (d.kind === "untagged") return UNTAGGED_COLOR;
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length];
}

export function BudgetChart({ summary }: { summary: BudgetSummary }) {
  const data = toPieData(summary);
  const isDeficit = summary.surplus < 0;

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={colorFor(d, i)} />
            ))}
          </Pie>
          <Tooltip formatter={(v: number) => formatCurrency(v)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-muted-foreground">Monthly expenses</span>
        <span className={`text-2xl font-bold ${isDeficit ? "text-finance-expense" : ""}`}>
          {formatCurrency(summary.totalExpense)}
        </span>
      </div>
      {isDeficit && (
        <div className="mt-3 rounded-md border border-finance-expense/40 bg-finance-expense/10 p-3 text-center">
          <span className="font-semibold text-finance-expense">
            Deficit: {formatCurrency(summary.surplus)}
          </span>
          <p className="text-xs text-muted-foreground">
            Monthly expenses exceed income by {formatCurrency(Math.abs(summary.surplus))}.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/budget/BudgetChart.tsx app/budget/budgetChartData.ts app/budget/budgetChartData.test.ts
git commit -m "feat(budget): donut chart with surplus slice and deficit callout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Budget page with chart + inline-retag legend

**Files:**
- Create: `app/budget/page.tsx`

**Interfaces:**
- Consumes: `particular.list` query, `particular.update` mutation, `category.list` query; `buildBudget` (Task 2); `BudgetChart` (Task 8); `formatCurrency`.
- Produces: the `/budget` route.

Notes:
- Build `BudgetParticular[]` for `buildBudget` by mapping `particular.list` rows: `{ type, amount: Number(p.amount), frequency, category: p.category }`.
- The legend lists `summary.categories` (and an "Untagged" group when present). Each group is expandable to its expenses; each expense has a datalist input to retag, calling `particular.update` with the full row plus the new `category`. On success, invalidate `particular.list`, `category.list`, and `forecast.getData`.
- `particular.update` requires the full `particularInput` shape — pass through the existing row's fields (name, type, amount as positive, frequency, startDate, endDate, isCritical, isFixed, businessDayAdjustment) plus `category`.

- [ ] **Step 1: Create the page**

```tsx
// app/budget/page.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Input } from "@/app/_components/ui/input";
import { formatCurrency } from "@/lib/design-system";
import { buildBudget, type BudgetParticular } from "@/lib/budget/budget";
import { BudgetChart } from "./BudgetChart";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

type Particular = inferRouterOutputs<AppRouter>["particular"]["list"][number];

export default function BudgetPage() {
  const utils = trpc.useUtils();
  const { data: particulars = [], isLoading } = trpc.particular.list.useQuery();
  const { data: categoryOptions = [] } = trpc.category.list.useQuery();
  const update = trpc.particular.update.useMutation({
    onSuccess: () => {
      utils.particular.list.invalidate();
      utils.category.list.invalidate();
      utils.forecast.getData.invalidate();
    },
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const expenses = particulars.filter((p) => p.type === "EXPENSE" && p.frequency !== "ONCE_OFF");
  const budgetInput: BudgetParticular[] = particulars.map((p) => ({
    type: p.type as "INCOME" | "EXPENSE",
    amount: Number(p.amount),
    frequency: p.frequency as BudgetParticular["frequency"],
    category: p.category,
  }));
  const summary = buildBudget(budgetInput);

  const retag = (p: Particular, category: string) => {
    update.mutate({
      id: p.id,
      name: p.name,
      type: p.type as "INCOME" | "EXPENSE",
      amount: Math.abs(Number(p.amount)),
      frequency: p.frequency as BudgetParticular["frequency"],
      startDate: new Date(p.startDate),
      endDate: p.endDate ? new Date(p.endDate) : undefined,
      isCritical: p.isCritical,
      isFixed: p.isFixed,
      businessDayAdjustment: p.businessDayAdjustment as Particular["businessDayAdjustment"],
      category,
    });
  };

  const groupName = (name: string) =>
    name === "" ? "Untagged" : name;

  // Build display groups: each category + an Untagged bucket if present.
  const groups: { name: string; monthly: number; key: string }[] = [
    ...summary.categories.map((c) => ({ name: c.name, monthly: c.monthly, key: c.name })),
    ...(summary.untagged > 0 ? [{ name: "Untagged", monthly: summary.untagged, key: "" }] : []),
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Budget</h1>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : expenses.length === 0 ? (
          <p className="text-muted-foreground">
            No recurring expenses yet. Add expenses and tag them with a category to see your budget.
          </p>
        ) : (
          <>
            <BudgetChart summary={summary} />
            <div className="space-y-2">
              {groups.map((g) => {
                const items = expenses.filter((e) => (e.category ?? "") === g.key);
                return (
                  <div key={g.key || "untagged"} className="rounded-md border p-3">
                    <button
                      className="flex w-full items-center justify-between text-left"
                      onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                    >
                      <span className="font-medium">{groupName(g.name)}</span>
                      <span className="text-finance-expense">{formatCurrency(g.monthly)}/mo</span>
                    </button>
                    {expanded === g.key && (
                      <div className="mt-3 space-y-2">
                        {items.map((e) => (
                          <div key={e.id} className="flex items-center justify-between gap-2">
                            <span className="text-sm">{e.name}</span>
                            <Input
                              className="h-8 w-40"
                              list="budget-category-options"
                              defaultValue={e.category ?? ""}
                              placeholder="Untagged"
                              onBlur={(ev) => {
                                const v = ev.target.value;
                                if (v !== (e.category ?? "")) retag(e, v);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <datalist id="budget-category-options">
                {categoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run the suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/budget/page.tsx
git commit -m "feat(budget): budget page with donut + inline retag legend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Budget nav item

**Files:**
- Modify: `app/_components/Sidebar.tsx`
- Modify: `app/_components/BottomNav.tsx`

**Interfaces:**
- Consumes: the `/budget` route (Task 9).

- [ ] **Step 1: Add to Sidebar**

In `app/_components/Sidebar.tsx`, change the icon import line to include `PieChart`:

```ts
import { LayoutDashboard, ListOrdered, CalendarDays, PieChart } from "lucide-react";
```

Add to the `items` array (after the particulars entry):

```ts
  { to: "/budget", label: "Budget", icon: PieChart },
```

- [ ] **Step 2: Add to BottomNav**

In `app/_components/BottomNav.tsx`, change the icon import line:

```ts
import { LayoutDashboard, ListOrdered, CalendarDays, PieChart } from "lucide-react";
```

Add to the `items` array (after the items entry):

```ts
  { to: "/budget", label: "Budget", icon: PieChart },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/_components/Sidebar.tsx app/_components/BottomNav.tsx
git commit -m "feat(budget): add Budget nav item to sidebar and bottom nav

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS — all suites including `lib/budget/*`, `lib/schemas/particular`, `server/categorySync`, `app/budget/budgetChartData`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Production build (catches client/server boundary + recharts issues)**

Run: `npx next build`
Expected: build completes; `/budget` appears in the route list.

- [ ] **Step 4: Confirm clean git state**

Run: `git status`
Expected: working tree clean (all tasks committed).

---

## Self-Review Notes

- **Spec coverage:** User.categories + Particular.category (Task 3); normalization (Tasks 1, 4); cleanup/derived-cache removing orphans (Tasks 5, 6); category engine `toMonthly`/`buildBudget` (Task 2); tagging in form (Task 7) and on budget page (Task 9); donut + surplus + deficit callout (Task 8); legend + inline retag (Task 9); nav item both navs (Task 10); category.list router (Task 6). All spec sections mapped.
- **Pure/impure split:** all unit-tested logic is pure (no DB); DB wrappers (`syncUserCategories`, routers) verified via typecheck + build, matching the repo's existing test conventions.
- **Type consistency:** `BudgetParticular`, `BudgetSummary`, `PieDatum`, `toPieData`, `buildBudget`, `toMonthly`, `normalizeCategory`, `parseCategories`, `serializeCategories`, `computeUserCategories`, `syncUserCategories`, `category.list` used consistently across tasks.
