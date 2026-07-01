# Debt Buster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/debts` section where users manage multiple debts and see a client-computed payoff forecast comparing snowball, avalanche, and custom strategies with an extra-payment knob and derived tips.

**Architecture:** A pure, deterministic engine module (`lib/engine/debt.ts`) does all payoff math and runs client-side for instant knob response — the same convention as `computeForecast`. A `Debt` Prisma model tied directly to `User` (no `FinanceAccount`, no membership/share relations — the absence is what makes it per-user and unshareable) is served by a CRUD-only `protectedProcedure` tRPC router scoped to `ctx.user.id`. The `/debts` client page fetches debts via tRPC React Query, runs `simulateDebtPayoff` locally three times, and renders list, summary, strategy comparison, a recharts line, and tips.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Vitest · tRPC 11 · Prisma 7 · PostgreSQL · Zod 4 · React Query 5 · recharts · Tailwind v4 · shadcn UI.

## Global Constraints

- Keep `lib/engine/` and `lib/schemas/` free of React/Prisma/Next imports (repo convention).
- Test runner is **Vitest** everywhere. No Playwright in this slice.
- Currency: NZD via the shared `formatCurrency` from `@/lib/design-system` (which uses `Intl.NumberFormat('en-NZ', …)`).
- `Debt.balance`/`minPayment` stored **positive**; `apr` stored as a **fraction** (0.1999 = 19.99%), the form converts the human-entered percentage in/out.
- The payoff simulation is **never a server procedure** — it runs client-side via the pure engine.
- Debt router procedures are `protectedProcedure` scoped to `ctx.user.id`. **No account resolution, no membership checks.**
- Schema changes are applied with `npm run db:push` (this repo uses Prisma `db push`, not migration files).
- Commit frequently — one commit per completed task.

---

### Task 1: Prisma `Debt` model

**Files:**
- Modify: `prisma/schema.prisma` (add `Debt` model; add `debts Debt[]` to `model User`)

**Interfaces:**
- Produces: a `Debt` table with columns `id, userId, name, balance (Decimal 15,2), apr (Decimal 6,4), minPayment (Decimal 15,2), sortOrder (Int default 0), createdAt, updatedAt`; `User.debts` back-relation; cascade delete on user.

- [ ] **Step 1: Add the `Debt` model to the schema**

Append to `prisma/schema.prisma`:

```prisma
model Debt {
  id         String   @id @default(cuid())
  userId     String
  name       String
  balance    Decimal  @db.Decimal(15, 2)   // outstanding, stored positive
  apr        Decimal  @db.Decimal(6, 4)    // annual rate as a fraction, e.g. 0.1999
  minPayment Decimal  @db.Decimal(15, 2)   // required monthly installment
  sortOrder  Int      @default(0)          // user's custom payoff priority
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- [ ] **Step 2: Add the back-relation to `User`**

In `model User`, add this line alongside the other relations (`accounts`, `sessions`, `memberships`):

```prisma
  debts         Debt[]
```

- [ ] **Step 3: Push the schema and regenerate the client**

Run: `npm run db:push`
Expected: Prisma reports the `Debt` table created and the client regenerated with no errors. (`db:push` runs `prisma db push`, which regenerates the client.)

- [ ] **Step 4: Verify the generated type exists**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -5`
Expected: no errors referencing `Debt`. (If the repo has pre-existing unrelated type errors, confirm none mention `Debt`.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(debt): add Debt Prisma model tied to User"
```

---

### Task 2: Zod schemas (`lib/schemas/debt.ts`)

**Files:**
- Create: `lib/schemas/debt.ts`
- Create: `lib/schemas/debt.test.ts`
- Modify: `lib/schemas/index.ts` (add `export * from "./debt";`)

**Interfaces:**
- Produces:
  - `debtInputSchema: ZodType` with fields `name: string` (trimmed, min 1, max 200), `balance: number` (≥ 0), `apr: number` (0–1 inclusive), `minPayment: number` (≥ 0).
  - `simulationParamsSchema: ZodType` with `strategy: "SNOWBALL"|"AVALANCHE"|"CUSTOM"`, `extraPayment: number` (≥ 0), `customOrder?: string[]`.
  - `type DebtInputSchema = z.infer<typeof debtInputSchema>`.
  - `type SimulationParams = z.infer<typeof simulationParamsSchema>`.

- [ ] **Step 1: Write the failing test**

Create `lib/schemas/debt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { debtInputSchema, simulationParamsSchema } from "./debt";

describe("debtInputSchema", () => {
  const valid = { name: "Visa", balance: 5000, apr: 0.1999, minPayment: 150 };

  it("accepts a valid debt", () => {
    expect(debtInputSchema.parse(valid)).toEqual(valid);
  });
  it("trims the name", () => {
    expect(debtInputSchema.parse({ ...valid, name: "  Visa  " }).name).toBe("Visa");
  });
  it("rejects an empty name", () => {
    expect(() => debtInputSchema.parse({ ...valid, name: "   " })).toThrow();
  });
  it("rejects a negative balance", () => {
    expect(() => debtInputSchema.parse({ ...valid, balance: -1 })).toThrow();
  });
  it("rejects apr above 1", () => {
    expect(() => debtInputSchema.parse({ ...valid, apr: 1.5 })).toThrow();
  });
  it("rejects apr below 0", () => {
    expect(() => debtInputSchema.parse({ ...valid, apr: -0.01 })).toThrow();
  });
  it("rejects a negative minPayment", () => {
    expect(() => debtInputSchema.parse({ ...valid, minPayment: -5 })).toThrow();
  });
  it("accepts 0% apr", () => {
    expect(debtInputSchema.parse({ ...valid, apr: 0 }).apr).toBe(0);
  });
});

describe("simulationParamsSchema", () => {
  it("accepts a valid snowball param with no custom order", () => {
    expect(simulationParamsSchema.parse({ strategy: "SNOWBALL", extraPayment: 100 }))
      .toEqual({ strategy: "SNOWBALL", extraPayment: 100 });
  });
  it("accepts a custom order array", () => {
    const r = simulationParamsSchema.parse({ strategy: "CUSTOM", extraPayment: 0, customOrder: ["a", "b"] });
    expect(r.customOrder).toEqual(["a", "b"]);
  });
  it("rejects a negative extraPayment", () => {
    expect(() => simulationParamsSchema.parse({ strategy: "SNOWBALL", extraPayment: -1 })).toThrow();
  });
  it("rejects an unknown strategy", () => {
    expect(() => simulationParamsSchema.parse({ strategy: "TURBO", extraPayment: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/debt.test.ts`
Expected: FAIL — cannot resolve `./debt` (module does not exist).

- [ ] **Step 3: Write the schemas**

Create `lib/schemas/debt.ts`:

```ts
import { z } from "zod";

export const debtInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  balance: z.number().min(0, "Balance must be zero or more"),
  apr: z.number().min(0, "APR must be zero or more").max(1, "APR is a fraction (0–1)"),
  minPayment: z.number().min(0, "Minimum payment must be zero or more"),
});

export const debtStrategy = z.enum(["SNOWBALL", "AVALANCHE", "CUSTOM"]);

export const simulationParamsSchema = z.object({
  strategy: debtStrategy,
  extraPayment: z.number().min(0, "Extra payment must be zero or more"),
  customOrder: z.array(z.string()).optional(),
});

export type DebtInputSchema = z.infer<typeof debtInputSchema>;
export type SimulationParams = z.infer<typeof simulationParamsSchema>;
```

- [ ] **Step 4: Wire up the barrel export**

In `lib/schemas/index.ts`, add:

```ts
export * from "./debt";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/schemas/debt.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add lib/schemas/debt.ts lib/schemas/debt.test.ts lib/schemas/index.ts
git commit -m "feat(debt): add debt input and simulation param zod schemas"
```

---

### Task 3: Engine core — single-debt accrual & minimum payments

**Files:**
- Create: `lib/engine/debt.ts`
- Create: `lib/engine/debt.test.ts`

**Interfaces:**
- Produces (final shape, filled in across Tasks 3–5):

```ts
export type DebtInput = { id: string; name: string; balance: number; apr: number; minPayment: number };
export type Strategy = "SNOWBALL" | "AVALANCHE" | "CUSTOM";
export type PerDebtMonth = { id: string; startBalance: number; interest: number; payment: number; endBalance: number };
export type DebtMonth = { month: number; perDebt: PerDebtMonth[]; totalBalance: number; totalInterest: number; totalPaid: number };
export type SimulateInput = { debts: DebtInput[]; strategy: Strategy; extraPayment: number; customOrder?: string[]; maxMonths?: number };
export type SimulateResult = {
  months: DebtMonth[];
  payoffMonth: number | null;
  totalInterest: number;
  totalPaid: number;
  perDebt: { id: string; payoffMonth: number | null; interestPaid: number }[];
};
export function simulateDebtPayoff(input: SimulateInput): SimulateResult;
```

This task implements a **single-debt, minimums-only** slice of that function (no ordering, no rollover). Later tasks extend the same function; do not rename it.

- [ ] **Step 1: Write the failing test**

Create `lib/engine/debt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { simulateDebtPayoff } from "./debt";

const round = (n: number) => Math.round(n * 100) / 100;

describe("simulateDebtPayoff — single debt, minimums only", () => {
  it("pays off a 0% APR debt in ceil(balance / minPayment) months", () => {
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Loan", balance: 1000, apr: 0, minPayment: 250 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    expect(r.payoffMonth).toBe(4);
    expect(r.perDebt).toEqual([{ id: "a", payoffMonth: 4, interestPaid: 0 }]);
    expect(round(r.totalInterest)).toBe(0);
    expect(round(r.totalPaid)).toBe(1000);
  });

  it("accrues monthly interest at apr/12 on the outstanding balance", () => {
    // 1200 @ 12% APR = 1% monthly. Month 1: interest = 12.00, pay 200 -> balance 1012.
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Card", balance: 1200, apr: 0.12, minPayment: 200 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    const m0 = r.months[0]!;
    expect(round(m0.perDebt[0]!.interest)).toBe(12);
    expect(round(m0.perDebt[0]!.startBalance)).toBe(1200);
    expect(round(m0.perDebt[0]!.payment)).toBe(200);
    expect(round(m0.perDebt[0]!.endBalance)).toBe(1012);
  });

  it("clears immediately when minPayment exceeds balance+interest in month 0", () => {
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Tiny", balance: 50, apr: 0.2, minPayment: 500 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    expect(r.payoffMonth).toBe(1);
    // pays only what is owed, never more than balance + interest
    expect(round(r.months[0]!.perDebt[0]!.payment)).toBe(round(50 + 50 * 0.2 / 12));
    expect(round(r.months[0]!.perDebt[0]!.endBalance)).toBe(0);
  });

  it("keeps the invariant totalPaid == startBalance + totalInterest", () => {
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Card", balance: 1200, apr: 0.12, minPayment: 200 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    expect(round(r.totalPaid)).toBe(round(1200 + r.totalInterest));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/debt.test.ts`
Expected: FAIL — cannot resolve `./debt`.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/engine/debt.ts`:

```ts
export type DebtInput = { id: string; name: string; balance: number; apr: number; minPayment: number };
export type Strategy = "SNOWBALL" | "AVALANCHE" | "CUSTOM";
export type PerDebtMonth = { id: string; startBalance: number; interest: number; payment: number; endBalance: number };
export type DebtMonth = {
  month: number;
  perDebt: PerDebtMonth[];
  totalBalance: number;
  totalInterest: number;
  totalPaid: number;
};
export type SimulateInput = {
  debts: DebtInput[];
  strategy: Strategy;
  extraPayment: number;
  customOrder?: string[];
  maxMonths?: number;
};
export type SimulateResult = {
  months: DebtMonth[];
  payoffMonth: number | null;
  totalInterest: number;
  totalPaid: number;
  perDebt: { id: string; payoffMonth: number | null; interestPaid: number }[];
};

const DEFAULT_MAX_MONTHS = 600;

type Live = { input: DebtInput; balance: number; interestPaid: number; payoffMonth: number | null };

export function simulateDebtPayoff(input: SimulateInput): SimulateResult {
  const maxMonths = input.maxMonths ?? DEFAULT_MAX_MONTHS;
  const live: Live[] = input.debts.map((d) => ({
    input: d,
    balance: d.balance,
    interestPaid: 0,
    payoffMonth: d.balance <= 0 ? 0 : null,
  }));

  const months: DebtMonth[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  while (live.some((l) => l.balance > 0) && month < maxMonths) {
    const perDebt: PerDebtMonth[] = [];
    let monthInterest = 0;
    let monthPaid = 0;

    for (const l of live) {
      const startBalance = l.balance;
      if (startBalance <= 0) {
        perDebt.push({ id: l.input.id, startBalance: 0, interest: 0, payment: 0, endBalance: 0 });
        continue;
      }
      const interest = startBalance * (l.input.apr / 12);
      const owed = startBalance + interest;
      const payment = Math.min(l.input.minPayment, owed);
      const endBalance = owed - payment;

      l.balance = endBalance;
      l.interestPaid += interest;
      monthInterest += interest;
      monthPaid += payment;
      if (endBalance <= 0 && l.payoffMonth === null) l.payoffMonth = month + 1;

      perDebt.push({ id: l.input.id, startBalance, interest, payment, endBalance });
    }

    totalInterest += monthInterest;
    totalPaid += monthPaid;
    months.push({
      month,
      perDebt,
      totalBalance: live.reduce((s, l) => s + l.balance, 0),
      totalInterest: monthInterest,
      totalPaid: monthPaid,
    });
    month += 1;
  }

  const allClear = live.every((l) => l.balance <= 0);
  return {
    months,
    payoffMonth: allClear ? month : null,
    totalInterest,
    totalPaid,
    perDebt: live.map((l) => ({ id: l.input.id, payoffMonth: l.payoffMonth, interestPaid: l.interestPaid })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/debt.test.ts`
Expected: PASS (all four cases green).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/debt.ts lib/engine/debt.test.ts
git commit -m "feat(engine): debt payoff — single debt accrual and minimum payments"
```

---

### Task 4: Engine — surplus, rollover, cascade & never-payoff cap

**Files:**
- Modify: `lib/engine/debt.ts`
- Modify: `lib/engine/debt.test.ts` (add cases)

**Interfaces:**
- Consumes: `simulateDebtPayoff` from Task 3.
- Produces: same `simulateDebtPayoff` signature, now applying `extraPayment` + freed-up minimums (rollover) to the strategy-ordered target debt, cascading overflow within the month, and returning `payoffMonth: null` (per-debt too) when balances never fall by `maxMonths`. Ordering itself is a helper `orderDebts` finished in Task 5; for this task use a **temporary ascending-balance order** so surplus behaviour is testable — Task 5 replaces the order source only.

- [ ] **Step 1: Write the failing tests**

Add to `lib/engine/debt.test.ts`:

```ts
describe("simulateDebtPayoff — surplus, rollover, cascade", () => {
  const round = (n: number) => Math.round(n * 100) / 100;

  it("applies extraPayment to the target debt on top of its minimum", () => {
    // 0% APR. minPayment 100 + extra 100 = 200/mo on the single debt.
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "L", balance: 1000, apr: 0, minPayment: 100 }],
      strategy: "SNOWBALL",
      extraPayment: 100,
    });
    expect(r.payoffMonth).toBe(5); // 1000 / 200
  });

  it("cascades surplus overflow to the next debt within the same month", () => {
    // Debt a: balance 100, min 0. Debt b: balance 1000, min 0. extra 300, 0% apr.
    // Month 0: a needs 100 -> cleared, 200 overflow cascades to b -> b 800.
    const r = simulateDebtPayoff({
      debts: [
        { id: "a", name: "A", balance: 100, apr: 0, minPayment: 0 },
        { id: "b", name: "B", balance: 1000, apr: 0, minPayment: 0 },
      ],
      strategy: "SNOWBALL",
      extraPayment: 300,
    });
    const m0 = r.months[0]!;
    const a0 = m0.perDebt.find((p) => p.id === "a")!;
    const b0 = m0.perDebt.find((p) => p.id === "b")!;
    expect(round(a0.endBalance)).toBe(0);
    expect(round(b0.endBalance)).toBe(800);
  });

  it("rolls a cleared debt's minimum into the surplus pool from the next month", () => {
    // a: balance 100, min 100 (clears month 0). b: balance 1000, min 100, 0% apr, extra 0.
    // Month 0: a pays 100 -> cleared; b pays 100 -> 900.
    // Month 1: a's freed 100 rolls onto b's target -> b pays 100 min + 100 rollover = 200 -> 700.
    const r = simulateDebtPayoff({
      debts: [
        { id: "a", name: "A", balance: 100, apr: 0, minPayment: 100 },
        { id: "b", name: "B", balance: 1000, apr: 0, minPayment: 100 },
      ],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    const b1 = r.months[1]!.perDebt.find((p) => p.id === "b")!;
    expect(round(b1.payment)).toBe(200);
    expect(round(b1.endBalance)).toBe(700);
  });

  it("returns payoffMonth null when minimums+extra never cover interest", () => {
    // 10000 @ 24% APR = 2%/mo = 200 interest. min 100, extra 0 -> balance grows.
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Bad", balance: 10000, apr: 0.24, minPayment: 100 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
      maxMonths: 12,
    });
    expect(r.payoffMonth).toBeNull();
    expect(r.perDebt[0]!.payoffMonth).toBeNull();
    expect(r.months.length).toBe(12);
  });

  it("holds totalPaid == sum(startBalance) + totalInterest across multiple debts", () => {
    const r = simulateDebtPayoff({
      debts: [
        { id: "a", name: "A", balance: 500, apr: 0.1, minPayment: 80 },
        { id: "b", name: "B", balance: 1500, apr: 0.18, minPayment: 120 },
      ],
      strategy: "SNOWBALL",
      extraPayment: 200,
    });
    expect(round(r.totalPaid)).toBe(round(2000 + r.totalInterest));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/debt.test.ts`
Expected: FAIL — surplus/rollover/cascade cases fail (extra payment not applied; overflow not cascaded).

- [ ] **Step 3: Extend the implementation**

Replace the body of the `while` loop's post-minimums section in `lib/engine/debt.ts`. The full updated function:

```ts
const DEFAULT_MAX_MONTHS = 600;

type Live = { input: DebtInput; balance: number; interestPaid: number; payoffMonth: number | null };

// Temporary ordering source (ascending balance). Task 5 replaces this with orderDebts(strategy).
function orderLive(live: Live[]): Live[] {
  return [...live].filter((l) => l.balance > 0).sort((a, b) => a.balance - b.balance);
}

export function simulateDebtPayoff(input: SimulateInput): SimulateResult {
  const maxMonths = input.maxMonths ?? DEFAULT_MAX_MONTHS;
  const live: Live[] = input.debts.map((d) => ({
    input: d,
    balance: d.balance,
    interestPaid: 0,
    payoffMonth: d.balance <= 0 ? 0 : null,
  }));

  const months: DebtMonth[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  while (live.some((l) => l.balance > 0) && month < maxMonths) {
    const rows = new Map<string, PerDebtMonth>();
    let monthInterest = 0;
    let monthPaid = 0;

    // Freed-up minimums from already-cleared debts feed the surplus pool.
    let surplus = input.extraPayment;
    for (const l of live) {
      if (l.balance <= 0) surplus += l.input.minPayment;
    }

    // 1) Accrue interest + pay minimums on each unpaid debt.
    for (const l of live) {
      const startBalance = l.balance;
      if (startBalance <= 0) {
        rows.set(l.input.id, { id: l.input.id, startBalance: 0, interest: 0, payment: 0, endBalance: 0 });
        continue;
      }
      const interest = startBalance * (l.input.apr / 12);
      const owed = startBalance + interest;
      const payment = Math.min(l.input.minPayment, owed);
      const endBalance = owed - payment;

      l.balance = endBalance;
      l.interestPaid += interest;
      monthInterest += interest;
      monthPaid += payment;
      rows.set(l.input.id, { id: l.input.id, startBalance, interest, payment, endBalance });
    }

    // 2) Apply surplus to strategy-ordered debts, cascading overflow.
    for (const l of orderLive(live)) {
      if (surplus <= 0) break;
      if (l.balance <= 0) continue;
      const applied = Math.min(surplus, l.balance);
      l.balance -= applied;
      surplus -= applied;
      monthPaid += applied;
      const row = rows.get(l.input.id)!;
      row.payment += applied;
      row.endBalance = l.balance;
    }

    // 3) Mark newly-cleared debts.
    for (const l of live) {
      if (l.balance <= 0 && l.payoffMonth === null) l.payoffMonth = month + 1;
    }

    totalInterest += monthInterest;
    totalPaid += monthPaid;
    months.push({
      month,
      perDebt: input.debts.map((d) => rows.get(d.id)!),
      totalBalance: live.reduce((s, l) => s + Math.max(0, l.balance), 0),
      totalInterest: monthInterest,
      totalPaid: monthPaid,
    });
    month += 1;
  }

  const allClear = live.every((l) => l.balance <= 0);
  return {
    months,
    payoffMonth: allClear ? month : null,
    totalInterest,
    totalPaid,
    perDebt: live.map((l) => ({ id: l.input.id, payoffMonth: l.payoffMonth, interestPaid: l.interestPaid })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/debt.test.ts`
Expected: PASS (Task 3 cases still green, plus the new surplus/rollover/cascade/never-payoff cases).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/debt.ts lib/engine/debt.test.ts
git commit -m "feat(engine): debt payoff — surplus, rollover, cascade, never-payoff cap"
```

---

### Task 5: Engine — strategy ordering (snowball / avalanche / custom) with deterministic tiebreaks

**Files:**
- Modify: `lib/engine/debt.ts`
- Modify: `lib/engine/debt.test.ts` (add cases)

**Interfaces:**
- Consumes: `simulateDebtPayoff` from Task 4.
- Produces:
  - `export function orderDebts(debts: DebtInput[], strategy: Strategy, customOrder?: string[]): DebtInput[]` — pure, exported for direct testing. SNOWBALL: ascending balance; AVALANCHE: descending apr; CUSTOM: order in `customOrder` (ids not listed fall to the end). Tiebreak in all modes: the order the debts appear in the input array (stable), then `id`.
  - `simulateDebtPayoff` now orders the surplus by `orderDebts(input.debts, input.strategy, input.customOrder)` restricted to still-unpaid debts, replacing the temporary `orderLive`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/engine/debt.test.ts`:

```ts
import { orderDebts } from "./debt";

describe("orderDebts", () => {
  const debts = [
    { id: "big-low", name: "Mortgage", balance: 20000, apr: 0.05, minPayment: 300 },
    { id: "small-high", name: "Card", balance: 800, apr: 0.24, minPayment: 40 },
    { id: "mid", name: "Loan", balance: 5000, apr: 0.12, minPayment: 150 },
  ];

  it("SNOWBALL orders by ascending balance", () => {
    expect(orderDebts(debts, "SNOWBALL").map((d) => d.id)).toEqual(["small-high", "mid", "big-low"]);
  });
  it("AVALANCHE orders by descending apr", () => {
    expect(orderDebts(debts, "AVALANCHE").map((d) => d.id)).toEqual(["small-high", "mid", "big-low"]);
  });
  it("CUSTOM follows customOrder, unlisted ids to the end", () => {
    expect(orderDebts(debts, "CUSTOM", ["mid", "big-low"]).map((d) => d.id)).toEqual(["mid", "big-low", "small-high"]);
  });

  it("breaks balance ties by input order (stable)", () => {
    const tied = [
      { id: "x", name: "X", balance: 1000, apr: 0.1, minPayment: 50 },
      { id: "y", name: "Y", balance: 1000, apr: 0.2, minPayment: 50 },
    ];
    expect(orderDebts(tied, "SNOWBALL").map((d) => d.id)).toEqual(["x", "y"]);
  });
  it("breaks apr ties by input order (stable)", () => {
    const tied = [
      { id: "x", name: "X", balance: 1000, apr: 0.1, minPayment: 50 },
      { id: "y", name: "Y", balance: 500, apr: 0.1, minPayment: 50 },
    ];
    expect(orderDebts(tied, "AVALANCHE").map((d) => d.id)).toEqual(["x", "y"]);
  });
});

describe("simulateDebtPayoff — strategy affects payoff order", () => {
  const debts = [
    { id: "small", name: "Small", balance: 500, apr: 0.05, minPayment: 50 },
    { id: "pricey", name: "Pricey", balance: 2000, apr: 0.3, minPayment: 50 },
  ];

  it("snowball clears the smallest-balance debt first", () => {
    const r = simulateDebtPayoff({ debts, strategy: "SNOWBALL", extraPayment: 200 });
    const small = r.perDebt.find((p) => p.id === "small")!;
    const pricey = r.perDebt.find((p) => p.id === "pricey")!;
    expect(small.payoffMonth!).toBeLessThan(pricey.payoffMonth!);
  });
  it("avalanche clears the highest-apr debt first", () => {
    const r = simulateDebtPayoff({ debts, strategy: "AVALANCHE", extraPayment: 200 });
    const small = r.perDebt.find((p) => p.id === "small")!;
    const pricey = r.perDebt.find((p) => p.id === "pricey")!;
    expect(pricey.payoffMonth!).toBeLessThan(small.payoffMonth!);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/debt.test.ts`
Expected: FAIL — `orderDebts` is not exported; strategy-order cases fail (temporary `orderLive` ignores strategy).

- [ ] **Step 3: Implement `orderDebts` and wire it in**

In `lib/engine/debt.ts`, add the exported helper and replace `orderLive`'s ordering source. Add near the top (after the types):

```ts
export function orderDebts(debts: DebtInput[], strategy: Strategy, customOrder?: string[]): DebtInput[] {
  const indexed = debts.map((d, i) => ({ d, i }));
  if (strategy === "CUSTOM") {
    const rank = new Map((customOrder ?? []).map((id, i) => [id, i] as const));
    return indexed
      .sort((a, b) => {
        const ra = rank.has(a.d.id) ? rank.get(a.d.id)! : Number.POSITIVE_INFINITY;
        const rb = rank.has(b.d.id) ? rank.get(b.d.id)! : Number.POSITIVE_INFINITY;
        return ra - rb || a.i - b.i || a.d.id.localeCompare(b.d.id);
      })
      .map((x) => x.d);
  }
  const key = strategy === "SNOWBALL"
    ? (d: DebtInput) => d.balance
    : (d: DebtInput) => -d.apr; // AVALANCHE: descending apr
  return indexed
    .sort((a, b) => key(a.d) - key(b.d) || a.i - b.i || a.d.id.localeCompare(b.d.id))
    .map((x) => x.d);
}
```

Then replace the temporary `orderLive` function with a strategy-aware version that keeps a stable `Live` lookup:

```ts
function orderLive(live: Live[], strategy: Strategy, customOrder?: string[]): Live[] {
  const byId = new Map(live.map((l) => [l.input.id, l] as const));
  return orderDebts(live.map((l) => l.input), strategy, customOrder)
    .map((d) => byId.get(d.id)!)
    .filter((l) => l.balance > 0);
}
```

And in the surplus loop inside `simulateDebtPayoff`, change the call:

```ts
    for (const l of orderLive(live, input.strategy, input.customOrder)) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/debt.test.ts`
Expected: PASS (all engine cases including ordering).

- [ ] **Step 5: Wire the engine into the barrel export**

In `lib/engine/index.ts`, add:

```ts
export * from "./debt";
```

- [ ] **Step 6: Run test to confirm no barrel breakage**

Run: `npx vitest run lib/engine`
Expected: PASS (existing engine tests + debt tests).

- [ ] **Step 7: Commit**

```bash
git add lib/engine/debt.ts lib/engine/debt.test.ts lib/engine/index.ts
git commit -m "feat(engine): debt payoff — snowball/avalanche/custom ordering with tiebreaks"
```

---

### Task 6: Tips — derived pure functions

**Files:**
- Create: `lib/engine/debtTips.ts`
- Create: `lib/engine/debtTips.test.ts`
- Modify: `lib/engine/index.ts` (add `export * from "./debtTips";`)

**Interfaces:**
- Consumes: `SimulateResult`, `DebtInput`, `Strategy` from `./debt`.
- Produces:

```ts
export type DebtTips = {
  recommendation:
    | { kind: "compare"; winner: "SNOWBALL" | "AVALANCHE"; monthsSaved: number; interestSaved: number }
    | { kind: "tie" }
    | { kind: "never-payoff" };
  nextTarget: { id: string; name: string } | null;   // first debt in the active strategy's order
  knobImpact:
    | { kind: "impact"; monthsSaved: number; interestSaved: number }
    | { kind: "none" }
    | { kind: "never-payoff" };
};

export function deriveTips(args: {
  debts: DebtInput[];
  activeStrategy: Strategy;
  customOrder?: string[];
  snowball: SimulateResult;
  avalanche: SimulateResult;
  active: SimulateResult;      // active strategy WITH current extraPayment
  activeNoExtra: SimulateResult; // active strategy with extraPayment 0
}): DebtTips;
```

- [ ] **Step 1: Write the failing test**

Create `lib/engine/debtTips.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveTips } from "./debtTips";
import type { SimulateResult } from "./debt";

const empty = { months: [], totalPaid: 0, perDebt: [] };
const res = (payoffMonth: number | null, totalInterest: number): SimulateResult =>
  ({ ...empty, payoffMonth, totalInterest } as SimulateResult);

const debts = [
  { id: "a", name: "Visa", balance: 800, apr: 0.24, minPayment: 40 },
  { id: "b", name: "Loan", balance: 5000, apr: 0.05, minPayment: 150 },
];

describe("deriveTips", () => {
  it("recommends avalanche when it clears sooner and cheaper", () => {
    const tips = deriveTips({
      debts, activeStrategy: "AVALANCHE",
      snowball: res(30, 900), avalanche: res(23, 448),
      active: res(23, 448), activeNoExtra: res(31, 1678),
    });
    expect(tips.recommendation).toEqual({
      kind: "compare", winner: "AVALANCHE", monthsSaved: 7, interestSaved: 452,
    });
  });

  it("recommends snowball when it wins on interest", () => {
    const tips = deriveTips({
      debts, activeStrategy: "SNOWBALL",
      snowball: res(20, 300), avalanche: res(22, 350),
      active: res(20, 300), activeNoExtra: res(28, 900),
    });
    expect(tips.recommendation).toEqual({
      kind: "compare", winner: "SNOWBALL", monthsSaved: 2, interestSaved: 50,
    });
  });

  it("reports a tie when months and interest match", () => {
    const tips = deriveTips({
      debts, activeStrategy: "SNOWBALL",
      snowball: res(20, 300), avalanche: res(20, 300),
      active: res(20, 300), activeNoExtra: res(20, 300),
    });
    expect(tips.recommendation).toEqual({ kind: "tie" });
  });

  it("degrades to never-payoff when a strategy never clears", () => {
    const tips = deriveTips({
      debts, activeStrategy: "AVALANCHE",
      snowball: res(null, 5000), avalanche: res(null, 5000),
      active: res(null, 5000), activeNoExtra: res(null, 6000),
    });
    expect(tips.recommendation).toEqual({ kind: "never-payoff" });
    expect(tips.knobImpact).toEqual({ kind: "never-payoff" });
  });

  it("names the next target from the active strategy order (avalanche = highest apr)", () => {
    const tips = deriveTips({
      debts, activeStrategy: "AVALANCHE",
      snowball: res(30, 900), avalanche: res(23, 448),
      active: res(23, 448), activeNoExtra: res(31, 1678),
    });
    expect(tips.nextTarget).toEqual({ id: "a", name: "Visa" });
  });

  it("computes knob impact from active vs active-with-no-extra", () => {
    const tips = deriveTips({
      debts, activeStrategy: "AVALANCHE",
      snowball: res(30, 900), avalanche: res(23, 448),
      active: res(23, 448), activeNoExtra: res(31, 1678),
    });
    expect(tips.knobImpact).toEqual({ kind: "impact", monthsSaved: 8, interestSaved: 1230 });
  });

  it("reports no knob impact when extra changed nothing", () => {
    const tips = deriveTips({
      debts, activeStrategy: "SNOWBALL",
      snowball: res(20, 300), avalanche: res(22, 350),
      active: res(20, 300), activeNoExtra: res(20, 300),
    });
    expect(tips.knobImpact).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/debtTips.test.ts`
Expected: FAIL — cannot resolve `./debtTips`.

- [ ] **Step 3: Write the implementation**

Create `lib/engine/debtTips.ts`:

```ts
import type { DebtInput, SimulateResult, Strategy } from "./debt";
import { orderDebts } from "./debt";

export type DebtTips = {
  recommendation:
    | { kind: "compare"; winner: "SNOWBALL" | "AVALANCHE"; monthsSaved: number; interestSaved: number }
    | { kind: "tie" }
    | { kind: "never-payoff" };
  nextTarget: { id: string; name: string } | null;
  knobImpact:
    | { kind: "impact"; monthsSaved: number; interestSaved: number }
    | { kind: "none" }
    | { kind: "never-payoff" };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function deriveTips(args: {
  debts: DebtInput[];
  activeStrategy: Strategy;
  customOrder?: string[];
  snowball: SimulateResult;
  avalanche: SimulateResult;
  active: SimulateResult;
  activeNoExtra: SimulateResult;
}): DebtTips {
  const { snowball, avalanche, active, activeNoExtra } = args;

  // Recommendation: snowball vs avalanche.
  let recommendation: DebtTips["recommendation"];
  if (snowball.payoffMonth === null || avalanche.payoffMonth === null) {
    recommendation = { kind: "never-payoff" };
  } else if (
    snowball.payoffMonth === avalanche.payoffMonth &&
    round2(snowball.totalInterest) === round2(avalanche.totalInterest)
  ) {
    recommendation = { kind: "tie" };
  } else {
    // Winner: fewer months, then less interest.
    const avalancheWins =
      avalanche.payoffMonth < snowball.payoffMonth ||
      (avalanche.payoffMonth === snowball.payoffMonth &&
        avalanche.totalInterest <= snowball.totalInterest);
    const winner = avalancheWins ? "AVALANCHE" : "SNOWBALL";
    const [win, lose] = avalancheWins ? [avalanche, snowball] : [snowball, avalanche];
    recommendation = {
      kind: "compare",
      winner,
      monthsSaved: lose.payoffMonth! - win.payoffMonth!,
      interestSaved: round2(lose.totalInterest - win.totalInterest),
    };
  }

  // Next target: first debt in the active strategy's order.
  const ordered = orderDebts(args.debts, args.activeStrategy, args.customOrder);
  const first = ordered[0];
  const nextTarget = first ? { id: first.id, name: first.name } : null;

  // Knob impact: active (with extra) vs active (no extra).
  let knobImpact: DebtTips["knobImpact"];
  if (active.payoffMonth === null || activeNoExtra.payoffMonth === null) {
    knobImpact = { kind: "never-payoff" };
  } else {
    const monthsSaved = activeNoExtra.payoffMonth - active.payoffMonth;
    const interestSaved = round2(activeNoExtra.totalInterest - active.totalInterest);
    knobImpact = monthsSaved === 0 && interestSaved === 0
      ? { kind: "none" }
      : { kind: "impact", monthsSaved, interestSaved };
  }

  return { recommendation, nextTarget, knobImpact };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/debtTips.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Wire the barrel export**

In `lib/engine/index.ts`, add:

```ts
export * from "./debtTips";
```

- [ ] **Step 6: Commit**

```bash
git add lib/engine/debtTips.ts lib/engine/debtTips.test.ts lib/engine/index.ts
git commit -m "feat(engine): derive debt tips from strategy comparison"
```

---

### Task 7: tRPC debt router (CRUD + reorder)

**Files:**
- Create: `server/routers/debt.ts`
- Create: `server/routers/debt.test.ts`
- Modify: `server/routers/_app.ts` (add `debt: debtRouter`)

**Interfaces:**
- Consumes: `protectedProcedure`, `router` from `../trpc`; `debtInputSchema` from `@/lib/schemas`.
- Produces:
  - `export function assertReorderIds(current: string[], requested: string[]): void` — pure guard (throws `TRPCError BAD_REQUEST` if the requested id set doesn't exactly match the user's current debt ids). Exported for direct unit testing (mirrors the `assertReassignAllowed` pattern).
  - `export const debtRouter` with `list`, `create`, `update`, `delete`, `reorder`, all `protectedProcedure` scoped to `ctx.user.id`.

- [ ] **Step 1: Write the failing test**

Create `server/routers/debt.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

// debt.ts imports ../trpc, which imports ./db (PrismaClient) and ./auth
// (next-auth, ESM-only). Stub both so this pure-function test doesn't
// construct a real client — matches server/routers/particular.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { assertReorderIds } from "./debt";

describe("assertReorderIds", () => {
  it("allows a permutation of exactly the current ids", () => {
    expect(() => assertReorderIds(["a", "b", "c"], ["c", "a", "b"])).not.toThrow();
  });
  it("rejects a missing id", () => {
    expect(() => assertReorderIds(["a", "b", "c"], ["a", "b"])).toThrow(/reorder/i);
  });
  it("rejects an unknown id", () => {
    expect(() => assertReorderIds(["a", "b"], ["a", "b", "x"])).toThrow(/reorder/i);
  });
  it("rejects a duplicate id", () => {
    expect(() => assertReorderIds(["a", "b"], ["a", "a"])).toThrow(/reorder/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routers/debt.test.ts`
Expected: FAIL — cannot resolve `./debt`.

- [ ] **Step 3: Write the router**

Create `server/routers/debt.ts`:

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { debtInputSchema } from "@/lib/schemas";

/** Throws unless `requested` is exactly a permutation of `current` (no missing/extra/dupes). */
export function assertReorderIds(current: string[], requested: string[]): void {
  const currentSet = new Set(current);
  const seen = new Set<string>();
  if (requested.length !== current.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "reorder ids must match your debts exactly" });
  }
  for (const id of requested) {
    if (!currentSet.has(id) || seen.has(id)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "reorder ids must match your debts exactly" });
    }
    seen.add(id);
  }
}

export const debtRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.debt.findMany({
      where: { userId: ctx.user.id },
      orderBy: { sortOrder: "asc" },
    })),

  create: protectedProcedure.input(debtInputSchema).mutation(async ({ ctx, input }) => {
    const max = await ctx.prisma.debt.aggregate({
      where: { userId: ctx.user.id },
      _max: { sortOrder: true },
    });
    return ctx.prisma.debt.create({
      data: { ...input, userId: ctx.user.id, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
  }),

  update: protectedProcedure
    .input(debtInputSchema.and(z.object({ id: z.string() })))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const owned = await ctx.prisma.debt.findFirst({ where: { id, userId: ctx.user.id } });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.debt.update({ where: { id }, data });
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.prisma.debt.deleteMany({ where: { id: input.id, userId: ctx.user.id } })),

  reorder: protectedProcedure.input(z.object({ ids: z.array(z.string()) })).mutation(async ({ ctx, input }) => {
    const current = await ctx.prisma.debt.findMany({
      where: { userId: ctx.user.id },
      select: { id: true },
    });
    assertReorderIds(current.map((d) => d.id), input.ids);
    await ctx.prisma.$transaction(
      input.ids.map((id, i) =>
        ctx.prisma.debt.update({ where: { id }, data: { sortOrder: i } })),
    );
    return { count: input.ids.length };
  }),
});
```

- [ ] **Step 4: Mount the router**

In `server/routers/_app.ts`, import and register it:

```ts
import { debtRouter } from "./debt";
```

and add `debt: debtRouter,` to the `appRouter` object.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/routers/debt.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the router wiring**

Run: `npx tsc --noEmit 2>&1 | grep -i "debt" || echo "no debt type errors"`
Expected: `no debt type errors`.

- [ ] **Step 7: Commit**

```bash
git add server/routers/debt.ts server/routers/debt.test.ts server/routers/_app.ts
git commit -m "feat(server): add debt tRPC router (CRUD + reorder)"
```

---

### Task 8: Debt form + list card components

**Files:**
- Create: `app/debts/DebtForm.tsx`
- Create: `app/debts/DebtCard.tsx`

**Interfaces:**
- Consumes: `debtInputSchema`, `DebtInputSchema` from `@/lib/schemas`; `formatCurrency` from `@/lib/design-system`; shadcn `Button`, `Input`, `Label`, `Card` from `@/app/_components/ui/*`.
- Produces:
  - `DebtForm` — controlled add/edit form. Props: `{ initial?: { id: string } & DebtInputSchema & { aprPercent: number }; onSubmit: (v: DebtInputSchema) => void; onCancel?: () => void; submitting?: boolean }`. Converts the human APR **percent** field to the `apr` fraction on submit (`apr = percent / 100`) and validates with `debtInputSchema`.
  - `DebtCard` — display card. Props: `{ debt: { id: string; name: string; balance: number; apr: number; minPayment: number }; onEdit: () => void; onDelete: () => void }`. Shows name, `formatCurrency(balance)`, `${(apr*100).toFixed(2)}%`, `formatCurrency(minPayment)/mo`.

- [ ] **Step 1: Write `DebtForm`**

Create `app/debts/DebtForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { debtInputSchema, type DebtInputSchema } from "@/lib/schemas";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";

type Initial = { name: string; balance: number; aprPercent: number; minPayment: number };

export function DebtForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial?: Initial;
  onSubmit: (v: DebtInputSchema) => void;
  onCancel?: () => void;
  submitting?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [balance, setBalance] = useState(initial?.balance != null ? String(initial.balance) : "");
  const [aprPercent, setAprPercent] = useState(initial?.aprPercent != null ? String(initial.aprPercent) : "");
  const [minPayment, setMinPayment] = useState(initial?.minPayment != null ? String(initial.minPayment) : "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = debtInputSchema.safeParse({
      name,
      balance: Number(balance),
      apr: Number(aprPercent) / 100,
      minPayment: Number(minPayment),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid debt");
      return;
    }
    setError(null);
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="debt-name">Name</Label>
        <Input id="debt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Visa" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-1">
          <Label htmlFor="debt-balance">Balance</Label>
          <Input id="debt-balance" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="debt-apr">APR %</Label>
          <Input id="debt-apr" inputMode="decimal" value={aprPercent} onChange={(e) => setAprPercent(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="debt-min">Min / mo</Label>
          <Input id="debt-min" inputMode="decimal" value={minPayment} onChange={(e) => setMinPayment(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-sm text-finance-expense">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>{initial ? "Save" : "Add debt"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Write `DebtCard`**

Create `app/debts/DebtCard.tsx`:

```tsx
"use client";

import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";

export function DebtCard({
  debt,
  onEdit,
  onDelete,
}: {
  debt: { id: string; name: string; balance: number; apr: number; minPayment: number };
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div>
        <p className="font-medium">{debt.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(debt.balance)} · {(debt.apr * 100).toFixed(2)}% · {formatCurrency(debt.minPayment)}/mo
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck the components**

Run: `npx tsc --noEmit 2>&1 | grep -iE "DebtForm|DebtCard" || echo "no debt-component type errors"`
Expected: `no debt-component type errors`. (If `Button`/`Card`/`Input`/`Label` prop names differ from what's shown, open `app/_components/ui/*.tsx` and match the actual exported prop signatures — do not invent props.)

- [ ] **Step 4: Commit**

```bash
git add app/debts/DebtForm.tsx app/debts/DebtCard.tsx
git commit -m "feat(debts): debt form and list card components"
```

---

### Task 9: Debt forecast chart + tips panel components

**Files:**
- Create: `app/debts/DebtForecastChart.tsx`
- Create: `app/debts/DebtTipsPanel.tsx`

**Interfaces:**
- Consumes: `recharts` (`LineChart`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer`); `SimulateResult` from `@/lib/engine`; `DebtTips` from `@/lib/engine`; `formatCurrency` from `@/lib/design-system`.
- Produces:
  - `DebtForecastChart` — props `{ result: SimulateResult }`. Renders a total-balance-over-months line from `result.months` (`{ month, totalBalance }`), down to the debt-free point.
  - `DebtTipsPanel` — props `{ tips: DebtTips; extraPayment: number }`. Renders the recommendation, next-target, and knob-impact sentences, degrading to the "minimums don't cover interest" message on `never-payoff`.

- [ ] **Step 1: Write `DebtForecastChart`**

Create `app/debts/DebtForecastChart.tsx`:

```tsx
"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SimulateResult } from "@/lib/engine";
import { formatCurrency } from "@/lib/design-system";

export function DebtForecastChart({ result }: { result: SimulateResult }) {
  const data = result.months.map((m) => ({ month: m.month, balance: Math.round(m.totalBalance * 100) / 100 }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <XAxis dataKey="month" tickFormatter={(m) => `${m}mo`} />
        <YAxis tickFormatter={(v) => formatCurrency(Number(v))} width={80} />
        <Tooltip
          formatter={(v) => formatCurrency(Number(v))}
          labelFormatter={(m) => `Month ${m}`}
        />
        <Line type="monotone" dataKey="balance" stroke="#2563eb" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Write `DebtTipsPanel`**

Create `app/debts/DebtTipsPanel.tsx`:

```tsx
"use client";

import type { DebtTips } from "@/lib/engine";
import { Card } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";

function pluralMonths(n: number) {
  return `${n} ${n === 1 ? "month" : "months"}`;
}

export function DebtTipsPanel({ tips, extraPayment }: { tips: DebtTips; extraPayment: number }) {
  const lines: string[] = [];

  if (tips.recommendation.kind === "compare") {
    const r = tips.recommendation;
    const name = r.winner === "AVALANCHE" ? "Avalanche" : "Snowball";
    lines.push(
      `${name} clears your debt ${pluralMonths(r.monthsSaved)} sooner and saves ${formatCurrency(r.interestSaved)} in interest.`,
    );
  } else if (tips.recommendation.kind === "tie") {
    lines.push("Snowball and avalanche finish at the same time and cost — pick whichever keeps you motivated.");
  } else {
    lines.push("Your minimum payments don't cover the interest — increase your payments to start clearing debt.");
  }

  if (tips.nextTarget) {
    lines.push(`Put your extra payments toward ${tips.nextTarget.name} next.`);
  }

  if (tips.knobImpact.kind === "impact") {
    lines.push(
      `Your extra ${formatCurrency(extraPayment)}/mo saves you ${pluralMonths(tips.knobImpact.monthsSaved)} and ${formatCurrency(tips.knobImpact.interestSaved)}.`,
    );
  } else if (tips.knobImpact.kind === "none" && extraPayment > 0) {
    lines.push(`Your extra ${formatCurrency(extraPayment)}/mo isn't changing the payoff — try a larger amount.`);
  }

  return (
    <Card className="grid gap-2 p-4">
      <p className="font-medium">Tips</p>
      {lines.map((l, i) => (
        <p key={i} className="text-sm text-muted-foreground">{l}</p>
      ))}
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck the components**

Run: `npx tsc --noEmit 2>&1 | grep -iE "DebtForecastChart|DebtTipsPanel" || echo "no debt-chart/tips type errors"`
Expected: `no debt-chart/tips type errors`.

- [ ] **Step 4: Commit**

```bash
git add app/debts/DebtForecastChart.tsx app/debts/DebtTipsPanel.tsx
git commit -m "feat(debts): forecast chart and tips panel components"
```

---

### Task 10: `/debts` page — wire everything together

**Files:**
- Create: `app/debts/page.tsx`

**Interfaces:**
- Consumes: `trpc` from `@/trpc/client`; `Layout` from `@/app/_components/Layout`; `simulateDebtPayoff`, `deriveTips`, types from `@/lib/engine`; `DebtForm`, `DebtCard`, `DebtForecastChart`, `DebtTipsPanel` from sibling files; `formatCurrency` from `@/lib/design-system`; shadcn `Card`, `Button`, `Input`, `Label`.
- Produces: the default-exported `DebtsPage` client component. Maps `debt.list` rows (Prisma `Decimal` → `Number`) to `DebtInput[]`, runs `simulateDebtPayoff` for snowball/avalanche/active/active-no-extra, derives tips, and renders list + summary + strategy toggle + extra-payment knob + chart + tips.

- [ ] **Step 1: Write the page**

Create `app/debts/page.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import {
  simulateDebtPayoff,
  deriveTips,
  type DebtInput,
  type Strategy,
} from "@/lib/engine";
import type { DebtInputSchema } from "@/lib/schemas";
import { formatCurrency } from "@/lib/design-system";
import { Card } from "@/app/_components/ui/card";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";
import { DebtForm } from "./DebtForm";
import { DebtCard } from "./DebtCard";
import { DebtForecastChart } from "./DebtForecastChart";
import { DebtTipsPanel } from "./DebtTipsPanel";

const STRATEGIES: { value: Strategy; label: string }[] = [
  { value: "SNOWBALL", label: "Snowball" },
  { value: "AVALANCHE", label: "Avalanche" },
  { value: "CUSTOM", label: "Custom" },
];

function monthsLabel(payoffMonth: number | null) {
  if (payoffMonth === null) return "Never (raise payments)";
  return `${payoffMonth} ${payoffMonth === 1 ? "month" : "months"}`;
}

export default function DebtsPage() {
  const utils = trpc.useUtils();
  const { data: rows = [], isLoading } = trpc.debt.list.useQuery();

  const [strategy, setStrategy] = useState<Strategy>("AVALANCHE");
  const [extraStr, setExtraStr] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const invalidate = () => utils.debt.list.invalidate();
  const create = trpc.debt.create.useMutation({ onSuccess: () => { setAdding(false); invalidate(); } });
  const update = trpc.debt.update.useMutation({ onSuccess: () => { setEditingId(null); invalidate(); } });
  const del = trpc.debt.delete.useMutation({ onSuccess: invalidate });

  const debts: DebtInput[] = useMemo(
    () => rows.map((d) => ({
      id: d.id,
      name: d.name,
      balance: Number(d.balance),
      apr: Number(d.apr),
      minPayment: Number(d.minPayment),
    })),
    [rows],
  );
  const customOrder = useMemo(() => debts.map((d) => d.id), [debts]);
  const extraPayment = Math.max(0, Number(extraStr) || 0);

  const sims = useMemo(() => {
    const run = (s: Strategy, extra: number) =>
      simulateDebtPayoff({ debts, strategy: s, extraPayment: extra, customOrder });
    const snowball = run("SNOWBALL", extraPayment);
    const avalanche = run("AVALANCHE", extraPayment);
    const active = run(strategy, extraPayment);
    const activeNoExtra = run(strategy, 0);
    return { snowball, avalanche, active, activeNoExtra };
  }, [debts, customOrder, strategy, extraPayment]);

  const tips = useMemo(
    () => deriveTips({
      debts, activeStrategy: strategy, customOrder,
      snowball: sims.snowball, avalanche: sims.avalanche,
      active: sims.active, activeNoExtra: sims.activeNoExtra,
    }),
    [debts, strategy, customOrder, sims],
  );

  const totalOwed = debts.reduce((s, d) => s + d.balance, 0);
  const totalMin = debts.reduce((s, d) => s + d.minPayment, 0);

  return (
    <Layout>
      <div className="mx-auto grid max-w-3xl gap-6">
        <div>
          <h1 className="text-2xl font-bold">Debt Buster</h1>
          <p className="text-sm text-muted-foreground">Plan your path to debt-free.</p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : debts.length === 0 && !adding ? (
          <Card className="grid gap-3 p-4">
            <p className="text-sm text-muted-foreground">No debts yet. Add your first to see a payoff forecast.</p>
            <Button onClick={() => setAdding(true)}>Add debt</Button>
          </Card>
        ) : (
          <>
            {debts.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Total owed</p>
                  <p className="text-xl font-bold">{formatCurrency(totalOwed)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Minimums / mo</p>
                  <p className="text-xl font-bold">{formatCurrency(totalMin)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground">Debt-free in</p>
                  <p className="text-xl font-bold">{monthsLabel(sims.active.payoffMonth)}</p>
                </Card>
              </div>
            )}

            <Card className="grid gap-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {STRATEGIES.map((s) => (
                  <Button
                    key={s.value}
                    type="button"
                    variant={strategy === s.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStrategy(s.value)}
                  >
                    {s.label} · {monthsLabel(
                      s.value === "SNOWBALL" ? sims.snowball.payoffMonth
                      : s.value === "AVALANCHE" ? sims.avalanche.payoffMonth
                      : simulateDebtPayoff({ debts, strategy: "CUSTOM", extraPayment, customOrder }).payoffMonth,
                    )}
                  </Button>
                ))}
              </div>
              <div className="grid max-w-xs gap-1">
                <Label htmlFor="extra">Extra payment / mo</Label>
                <Input
                  id="extra"
                  inputMode="decimal"
                  value={extraStr}
                  onChange={(e) => setExtraStr(e.target.value)}
                />
              </div>
              {debts.length > 0 && <DebtForecastChart result={sims.active} />}
            </Card>

            {debts.length > 0 && <DebtTipsPanel tips={tips} extraPayment={extraPayment} />}

            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Your debts</h2>
                {!adding && <Button size="sm" onClick={() => setAdding(true)}>Add debt</Button>}
              </div>
              {adding && (
                <Card className="p-4">
                  <DebtForm
                    onSubmit={(v) => create.mutate(v)}
                    onCancel={() => setAdding(false)}
                    submitting={create.isPending}
                  />
                </Card>
              )}
              {rows.map((d) =>
                editingId === d.id ? (
                  <Card key={d.id} className="p-4">
                    <DebtForm
                      initial={{
                        name: d.name,
                        balance: Number(d.balance),
                        aprPercent: Number(d.apr) * 100,
                        minPayment: Number(d.minPayment),
                      }}
                      onSubmit={(v) => update.mutate({ id: d.id, ...v })}
                      onCancel={() => setEditingId(null)}
                      submitting={update.isPending}
                    />
                  </Card>
                ) : (
                  <DebtCard
                    key={d.id}
                    debt={{
                      id: d.id,
                      name: d.name,
                      balance: Number(d.balance),
                      apr: Number(d.apr),
                      minPayment: Number(d.minPayment),
                    }}
                    onEdit={() => setEditingId(d.id)}
                    onDelete={() => del.mutate({ id: d.id })}
                  />
                ),
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Typecheck the page**

Run: `npx tsc --noEmit 2>&1 | grep -i "app/debts/page" || echo "no debts page type errors"`
Expected: `no debts page type errors`. (If `Button`'s `variant` values `"default"`/`"outline"`/`"ghost"` don't match the actual union in `app/_components/ui/button.tsx`, adjust to the real variant names.)

- [ ] **Step 3: Verify the page renders authenticated**

Follow the memory note `verifying-authed-pages` (forge a DB Session + cookie against the running dev server on :3000) to GET `/debts` and confirm a 200 with the "Debt Buster" heading. If no dev server is running, start one on a free port per the `dev-server-convention` memory.

Expected: page returns 200 and contains "Debt Buster".

- [ ] **Step 4: Commit**

```bash
git add app/debts/page.tsx
git commit -m "feat(debts): /debts page wiring list, strategy toggle, knob, chart, tips"
```

---

### Task 11: Navigation entries

**Files:**
- Modify: `app/_components/Sidebar.tsx` (add Debts item)
- Modify: `app/_components/BottomNav.tsx` (add Debts item)

**Interfaces:**
- Consumes: existing `items` array pattern and lucide icons in both nav components.
- Produces: a `{ to: "/debts", label: "Debts", icon: TrendingDown }` entry visible in both the sidebar and bottom nav, with active-state highlighting via the existing `pathname === to` logic.

- [ ] **Step 1: Add the Debts entry to the sidebar**

In `app/_components/Sidebar.tsx`, add `TrendingDown` to the lucide import:

```tsx
import { LayoutDashboard, ListOrdered, CalendarDays, PieChart, TrendingDown } from "lucide-react";
```

and add to the `items` array (after Spending):

```tsx
  { to: "/debts", label: "Debts", icon: TrendingDown },
```

- [ ] **Step 2: Add the Debts entry to the bottom nav**

In `app/_components/BottomNav.tsx`, add `TrendingDown` to the lucide import:

```tsx
import { LayoutDashboard, ListOrdered, CalendarDays, PieChart, Sun, Moon, TrendingDown } from "lucide-react";
```

and add to the `items` array (after Spending):

```tsx
  { to: "/debts", label: "Debts", icon: TrendingDown },
```

- [ ] **Step 3: Typecheck the nav changes**

Run: `npx tsc --noEmit 2>&1 | grep -iE "Sidebar|BottomNav" || echo "no nav type errors"`
Expected: `no nav type errors`.

- [ ] **Step 4: Commit**

```bash
git add app/_components/Sidebar.tsx app/_components/BottomNav.tsx
git commit -m "feat(debts): add Debts nav entry to sidebar and bottom nav"
```

---

### Task 12: Full verification & final commit

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- run`
Expected: PASS — all suites green, including `lib/engine/debt.test.ts`, `lib/engine/debtTips.test.ts`, `lib/schemas/debt.test.ts`, `server/routers/debt.test.ts`, and every pre-existing suite.

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Confirm the pure-module boundary held**

Run: `grep -rnE "from \"(react|@prisma|next)" lib/engine/debt.ts lib/engine/debtTips.ts lib/schemas/debt.ts || echo "clean: no React/Prisma/Next imports in pure modules"`
Expected: `clean: no React/Prisma/Next imports in pure modules`.

- [ ] **Step 4: Final review commit (if any lint/format fixups were needed)**

If steps 1–3 required no changes, there is nothing to commit — the feature is complete across the per-task commits. Otherwise:

```bash
git add -A
git commit -m "chore(debts): final verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), pure engine incl. all edge cases — 0% APR, single debt, extra 0, min>balance, ties, never-payoff (Tasks 3–5), tips as pure functions (Task 6), schemas with boundary validation (Task 2), router with user-scoping + sortOrder + reorder (Task 7), UI list/summary/toggle/knob/chart/tips (Tasks 8–10), navigation (Task 11), testing throughout, no Playwright.
- **Non-goals respected:** no `FinanceAccount`/membership/share relations; abstract month indices (no calendar dates); NZD via shared `formatCurrency`.
- **Follow-ups left out by design:** calendar anchoring, seed-from-credit-account, lump-sum payments, variable APR, Playwright — all captured in the spec's Follow-ups, not built here.
- **Type consistency:** `simulateDebtPayoff`/`orderDebts`/`deriveTips`/`DebtTips` signatures are identical everywhere they appear; `apr` is a fraction end-to-end with the percent↔fraction conversion isolated to `DebtForm` and the edit `initial` mapping.
- **Note on `reorder` in UI:** the router exposes `reorder`, and the page passes `customOrder` derived from list order so CUSTOM works today; interactive drag-to-persist is intentionally minimal (list order = sortOrder). If drag reordering is desired it's a thin follow-up calling `debt.reorder`.
```