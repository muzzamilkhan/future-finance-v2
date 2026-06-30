# Credit Accounts & Cross-Account Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CREDIT` account type (with adjustable limit and outstanding-owed anchor) and a `TRANSFER` particular type that moves money between two of a user's accounts, rendered into a single combined "cash available" forecast line.

**Architecture:** `FinanceAccount` gains `type` (`DEBIT|CREDIT`) and `creditLimit`. `Particular` gains a nullable `toAccountId` and a `TRANSFER` type. The pure engine is generalised from a single-ledger replay to a per-account replay summed into one combined line; credit available = `creditLimit + outstanding` (outstanding stored negative). Transfers emit paired ∓ events on the two accounts. A new combined-forecast endpoint aggregates across the accounts a user is a member of, rather than a single selected account.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Vitest · tRPC 11 · Prisma 7 · PostgreSQL · Zod 4 · React Query 5 · date-fns.

## Global Constraints

- Test runner is **Vitest** everywhere. No Playwright.
- `lib/engine/` and `lib/schemas/` must stay free of React/Prisma/Next imports.
- `Particular.amount` is stored **positive**; sign applied from `type` in the engine (TRANSFER = − on from-account, + on to-account).
- Forecast **always replays from each account's `balanceUpdatedAt`** forward, then slices — never a floating window start. The per-account replay invariant applies to every account.
- Overrides matched by `(particularId, originalDate)` with a UTC y/m/d compare.
- Override rules: amount override requires `!isFixed`; date/skip requires `!isCritical`. Enforced server-side, mirrored client-side. Same rules apply to TRANSFER.
- Credit `currentBalance` stores **outstanding owed, negative**; `availableCredit = creditLimit + currentBalance` is derived, never stored.
- Account `type` is immutable after creation; `TRANSFER` particulars cannot be reassigned.
- Currency: NZD via `Intl.NumberFormat('en-NZ', …)`.
- Commit after each task.

---

## File Structure

- `prisma/schema.prisma` — add `AccountType` enum, `FinanceAccount.type` + `creditLimit`, `Particular.toAccountId` + `toAccount` relation, `TRANSFER` in `ParticularType`.
- `lib/engine/types.ts` — extend `EngineParticular` (accountId, toAccountId), add `EngineAccount`, extend `ForecastInput`/`ForecastResult`/`DailyBalance`/`DailyEvent`/`MonthlySummary`.
- `lib/engine/instances.ts` — `signed()` handles `TRANSFER`; instances carry the particular's account routing through unchanged (routing handled in forecast).
- `lib/engine/forecast.ts` — per-account replay + combined line.
- `lib/schemas/particular.ts` — add `TRANSFER` to `particularType`; add `toAccountId` + cross-field refinements.
- `lib/schemas/account.ts` — `createCreditAccountInput`, `updateCreditLimitInput`; keep `updateBalanceInput`.
- `lib/toEngine.ts` — map multi-account combined-forecast payload to engine inputs.
- `server/routers/account.ts` — `createCredit`, `updateCreditLimit`; balance update unchanged.
- `server/routers/particular.ts` — transfer create/update validation; `reassignAccount`.
- `server/routers/forecast.ts` — `getCombined` across the user's accounts.
- `server/transfers.ts` (new) — pure validation helper `assertTransferShape`.
- `app/_components/...` + `app/particulars/...` — credit-account add flow, transfer form fields, reassign action, combined dashboard line, `[from] -> [to]` label.

---

## Task 1: Schema — AccountType, credit limit, transfer FK

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `AccountType` enum (`DEBIT|CREDIT`); `FinanceAccount.type: AccountType @default(DEBIT)`, `FinanceAccount.creditLimit: Decimal?`; `Particular.toAccountId: String?` + `toAccount` relation; `ParticularType` gains `TRANSFER`.

- [ ] **Step 1: Add the enum and fields**

In `prisma/schema.prisma`, add near the other enums:

```prisma
enum AccountType {
  DEBIT
  CREDIT
}
```

In `model FinanceAccount`, after `balanceUpdatedAt`:

```prisma
  type             AccountType @default(DEBIT)
  creditLimit      Decimal?    @db.Decimal(15, 2)
```

In `model Particular`, after `accountId`:

```prisma
  toAccountId           String?
```

and add a second relation to `FinanceAccount` (alongside the existing `account` relation):

```prisma
  toAccount             FinanceAccount?       @relation("TransferDestination", fields: [toAccountId], references: [id], onDelete: Cascade)
```

The existing `account` relation must be named to coexist with the new one. Change the existing `Particular.account` line to:

```prisma
  account               FinanceAccount        @relation("ParticularSource", fields: [accountId], references: [id], onDelete: Cascade)
```

In `model FinanceAccount`, the existing `particulars Particular[]` becomes the source side, and add the destination back-relation:

```prisma
  particulars      Particular[]   @relation("ParticularSource")
  transfersIn      Particular[]   @relation("TransferDestination")
```

In `enum ParticularType`, add `TRANSFER`:

```prisma
enum ParticularType {
  INCOME
  EXPENSE
  TRANSFER
}
```

Add an index for destination lookups in `model Particular`:

```prisma
  @@index([toAccountId])
```

- [ ] **Step 2: Format and validate the schema**

Run: `npx prisma format && npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 3: Create the migration**

Run: `npx prisma migrate dev --name credit-accounts-and-transfers`
Expected: migration created and applied; `Prisma Client` regenerated. Existing rows get `type = DEBIT` (the default) and `toAccountId = NULL` automatically.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): account type, credit limit, transfer destination FK"
```

---

## Task 2: Engine types — accounts & transfer routing

**Files:**
- Modify: `lib/engine/types.ts`
- Test: `lib/engine/types.test.ts`

**Interfaces:**
- Consumes: existing `EngineParticular`, `ForecastInput`, `DailyBalance`, `DailyEvent`, `MonthlySummary`.
- Produces:
  - `ParticularType = "INCOME" | "EXPENSE" | "TRANSFER"`.
  - `EngineParticular` gains `accountId: string` and `toAccountId: string | null`.
  - `EngineAccount = { id: string; type: "DEBIT" | "CREDIT"; anchorBalance: number; anchorDate: Date; creditLimit: number | null }`.
  - `ForecastInput` replaces `anchorBalance`/`anchorDate` with `accounts: EngineAccount[]`.
  - `AccountDaily = { accountId: string; type: "DEBIT" | "CREDIT"; balance: number; availableCredit: number | null; isExhausted: boolean }`.
  - `DailyBalance.combined: number` and `DailyBalance.accounts: AccountDaily[]`.
  - `DailyEvent` gains `fromAccountId: string`, `toAccountId: string | null`.
  - `MonthlySummary.combinedClosing: number`.

- [ ] **Step 1: Write the failing test**

Append to `lib/engine/types.test.ts` (create the file if it doesn't exist with the import below):

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EngineAccount, EngineParticular, ForecastInput, DailyBalance, DailyEvent } from "./types";

describe("engine types for credit + transfers", () => {
  it("EngineAccount carries type, anchor, and limit", () => {
    expectTypeOf<EngineAccount>().toMatchTypeOf<{
      id: string; type: "DEBIT" | "CREDIT"; anchorBalance: number; anchorDate: Date; creditLimit: number | null;
    }>();
  });
  it("EngineParticular routes to an account and optional destination", () => {
    expectTypeOf<EngineParticular["accountId"]>().toEqualTypeOf<string>();
    expectTypeOf<EngineParticular["toAccountId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<EngineParticular["type"]>().toEqualTypeOf<"INCOME" | "EXPENSE" | "TRANSFER">();
  });
  it("ForecastInput takes accounts, DailyBalance reports combined + per-account", () => {
    expectTypeOf<ForecastInput["accounts"]>().toEqualTypeOf<EngineAccount[]>();
    expectTypeOf<DailyBalance["combined"]>().toEqualTypeOf<number>();
    expectTypeOf<DailyEvent["fromAccountId"]>().toEqualTypeOf<string>();
    expectTypeOf<DailyEvent["toAccountId"]>().toEqualTypeOf<string | null>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/types.test.ts`
Expected: FAIL — type errors / properties missing (`EngineAccount` not exported, `accountId` missing, etc.).

- [ ] **Step 3: Implement the type changes**

In `lib/engine/types.ts`:

Change `ParticularType`:

```ts
export type ParticularType = "INCOME" | "EXPENSE" | "TRANSFER";
```

Add to `EngineParticular` (after `id`):

```ts
  accountId: string;
  toAccountId: string | null; // set only for TRANSFER
```

Add the account type and per-day shape:

```ts
export interface EngineAccount {
  id: string;
  type: "DEBIT" | "CREDIT";
  anchorBalance: number; // debit cash; credit outstanding (negative)
  anchorDate: Date;
  creditLimit: number | null; // only for CREDIT
}

export interface AccountDaily {
  accountId: string;
  type: "DEBIT" | "CREDIT";
  balance: number; // debit cash; credit outstanding (negative)
  availableCredit: number | null; // creditLimit + balance, for CREDIT only
  isExhausted: boolean; // debit balance < 0, or credit availableCredit < 0
}
```

Extend `DailyEvent` (add after `name`):

```ts
  fromAccountId: string;
  toAccountId: string | null; // set only for TRANSFER
```

Extend `DailyBalance` (add after `closingBalance`):

```ts
  combined: number; // Σ debit balances + Σ available credit
  accounts: AccountDaily[];
```

Extend `MonthlySummary` (add after `closingBalance`):

```ts
  combinedClosing: number;
```

In `ForecastInput` (in `forecast.ts`, see Task 4) `anchorBalance`/`anchorDate` are replaced by `accounts`. For this task, only `types.ts` changes; the `ForecastInput`/`ForecastResult` re-export line at the bottom stays.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/types.ts lib/engine/types.test.ts
git commit -m "feat(engine): account + transfer routing types"
```

---

## Task 3: Engine instances — TRANSFER sign

**Files:**
- Modify: `lib/engine/instances.ts`
- Test: `lib/engine/instances.test.ts`

**Interfaces:**
- Consumes: `EngineParticular` with `type: "TRANSFER"`.
- Produces: `generateInstances` returns instances whose `amount` is **negative** for a TRANSFER (the from-account leg). The forecast layer (Task 4) mirrors it to +amount on the destination. `signed("TRANSFER", x) === -Math.abs(x)`.

- [ ] **Step 1: Write the failing test**

Append to `lib/engine/instances.test.ts`:

```ts
import { generateInstances } from "./instances";
import type { EngineParticular } from "./types";

function transfer(over: Partial<EngineParticular> = {}): EngineParticular {
  return {
    id: "t1", name: "Card payment", type: "TRANSFER",
    accountId: "debit", toAccountId: "credit", amount: 100,
    frequency: "ONCE_OFF", startDate: new Date(Date.UTC(2026, 0, 10)),
    endDate: null, isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    overrides: [], ...over,
  };
}

it("a transfer instance is negative (the from-account leg)", () => {
  const out = generateInstances(transfer(), new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 31)), []);
  expect(out).toHaveLength(1);
  expect(out[0].amount).toBe(-100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/instances.test.ts`
Expected: FAIL — `signed` currently returns `+100` for any non-EXPENSE type, so `amount` is `100`, not `-100`.

- [ ] **Step 3: Implement**

In `lib/engine/instances.ts`, change `signed`:

```ts
function signed(type: EngineParticular["type"], amount: number): number {
  return type === "INCOME" ? Math.abs(amount) : -Math.abs(amount);
}
```

(INCOME is +; EXPENSE and TRANSFER from-leg are −.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/instances.test.ts`
Expected: PASS (existing income/expense tests still pass — EXPENSE was already negative; INCOME still positive).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/instances.ts lib/engine/instances.test.ts
git commit -m "feat(engine): transfer from-leg is negative-signed"
```

---

## Task 4: Engine forecast — per-account replay + combined line

**Files:**
- Modify: `lib/engine/forecast.ts`
- Test: `lib/engine/forecast.test.ts`

**Interfaces:**
- Consumes: `EngineAccount[]`, `EngineParticular` (with `accountId`/`toAccountId`), `generateInstances`.
- Produces: `ForecastInput` = `{ accounts: EngineAccount[]; viewStart; viewEnd; today; skipToday; particulars; holidays }` (no top-level `anchorBalance`/`anchorDate`). `computeForecast` returns `ForecastResult` whose `days[i]` has `combined`, `accounts: AccountDaily[]`, and per-event `fromAccountId`/`toAccountId`. `firstNegative`/`lowest`/`highest` are computed on the **combined** line.

- [ ] **Step 1: Write the failing test**

Append to `lib/engine/forecast.test.ts` (reuse existing helpers if present; otherwise these are self-contained):

```ts
import { computeForecast } from "./forecast";
import type { EngineAccount, EngineParticular } from "./types";

const day = (m: number, d: number) => new Date(Date.UTC(2026, m, d));

function input(particulars: EngineParticular[], accounts: EngineAccount[]) {
  return {
    accounts,
    viewStart: day(0, 1), viewEnd: day(0, 31),
    today: day(0, 1), skipToday: false,
    particulars, holidays: [],
  };
}

const debit: EngineAccount = { id: "debit", type: "DEBIT", anchorBalance: 1000, anchorDate: day(0, 1), creditLimit: null };
const credit: EngineAccount = { id: "credit", type: "CREDIT", anchorBalance: -200, anchorDate: day(0, 1), creditLimit: 1000 };

function p(over: Partial<EngineParticular>): EngineParticular {
  return {
    id: "x", name: "x", type: "EXPENSE", accountId: "debit", toAccountId: null, amount: 0,
    frequency: "ONCE_OFF", startDate: day(0, 5), endDate: null,
    isCritical: true, isFixed: true, businessDayAdjustment: "NONE", overrides: [], ...over,
  };
}

it("combined line on day 1 = debit cash + available credit", () => {
  const r = computeForecast(input([], [debit, credit]));
  // available credit = 1000 + (-200) = 800; combined = 1000 + 800 = 1800
  expect(r.days[0].combined).toBe(1800);
});

it("a debit expense lowers debit and the combined line", () => {
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "debit", amount: 100 })], [debit, credit]));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  expect(d5.accounts.find((a) => a.accountId === "debit")!.balance).toBe(900);
  expect(d5.combined).toBe(1700);
});

it("a credit expense lowers available credit and the combined line", () => {
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "credit", amount: 100 })], [debit, credit]));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  const c = d5.accounts.find((a) => a.accountId === "credit")!;
  expect(c.balance).toBe(-300);            // outstanding grew
  expect(c.availableCredit).toBe(700);     // 1000 + (-300)
  expect(d5.combined).toBe(1700);          // 1000 + 700
});

it("a debit->credit transfer nets to zero on the combined line", () => {
  const r = computeForecast(input(
    [p({ id: "t", type: "TRANSFER", accountId: "debit", toAccountId: "credit", amount: 150 })],
    [debit, credit],
  ));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  expect(d5.accounts.find((a) => a.accountId === "debit")!.balance).toBe(850);   // −150
  const c = d5.accounts.find((a) => a.accountId === "credit")!;
  expect(c.balance).toBe(-50);             // outstanding −200 + 150 paid down
  expect(c.availableCredit).toBe(950);     // 1000 + (-50)
  expect(d5.combined).toBe(1800);          // unchanged: 850 + 950
});

it("available credit may go negative (soft limit) and is flagged exhausted", () => {
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "credit", amount: 900 })], [debit, credit]));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  const c = d5.accounts.find((a) => a.accountId === "credit")!;
  expect(c.availableCredit).toBe(-100);    // 1000 + (-1100)
  expect(c.isExhausted).toBe(true);
});

it("transfer event carries from/to account ids", () => {
  const r = computeForecast(input(
    [p({ id: "t", type: "TRANSFER", accountId: "debit", toAccountId: "credit", amount: 150 })],
    [debit, credit],
  ));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  const ev = d5.events.find((e) => e.particularId === "t")!;
  expect(ev.fromAccountId).toBe("debit");
  expect(ev.toAccountId).toBe("credit");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/forecast.test.ts`
Expected: FAIL — `ForecastInput` no longer has `anchorBalance`; `days[i].combined`/`accounts` undefined.

- [ ] **Step 3: Implement the per-account replay**

Rewrite `lib/engine/forecast.ts`:

```ts
import { startOfDay, compareAsc, addDays } from "date-fns";
import { generateInstances } from "./instances";
import type {
  EngineParticular, EngineHoliday, EngineAccount, AccountDaily,
  DailyBalance, DailyEvent, MonthlySummary,
} from "./types";

export interface ForecastInput {
  accounts: EngineAccount[];
  viewStart: Date;
  viewEnd: Date;
  today: Date;
  skipToday: boolean;
  particulars: EngineParticular[];
  holidays: EngineHoliday[];
}

export interface ForecastResult {
  days: DailyBalance[];
  months: MonthlySummary[];
  firstNegative: DailyBalance | null;
  lowest: DailyBalance | null;
  highest: DailyBalance | null;
}

type RawEvent = {
  name: string; particularId: string; amount: number; accountId: string; toAccountId: string | null;
  isOverridden: boolean; isSkipped: boolean; isMovedDueToHoliday: boolean;
  isOverridable: boolean; originalDate?: Date; overrideId?: string;
};

export function computeForecast(input: ForecastInput): ForecastResult {
  const { accounts, viewStart, viewEnd, today, skipToday, particulars, holidays } = input;

  const earliestAnchor = accounts.reduce(
    (min, a) => (a.anchorDate < min ? a.anchorDate : min),
    viewStart,
  );
  const replayStart = startOfDay(earliestAnchor < viewStart ? earliestAnchor : viewStart);
  const displayStart = startOfDay(viewStart);
  const end = startOfDay(viewEnd);
  const todayKey = startOfDay(today).getTime();

  // Per-account running balance, seeded at anchor.
  const running = new Map<string, number>();
  for (const a of accounts) running.set(a.id, a.anchorBalance);
  const acctById = new Map(accounts.map((a) => [a.id, a]));

  // Group raw events by day.
  const byDay = new Map<number, RawEvent[]>();
  for (const p of particulars) {
    const isOverridable = !p.isFixed || !p.isCritical;
    for (const inst of generateInstances(p, replayStart, end, holidays)) {
      const key = startOfDay(inst.date).getTime();
      const list = byDay.get(key) ?? [];
      list.push({
        name: p.name, particularId: p.id, amount: inst.amount,
        accountId: p.accountId, toAccountId: p.toAccountId,
        isOverridden: inst.isOverridden, isSkipped: inst.isSkipped,
        isMovedDueToHoliday: inst.isMovedDueToHoliday, isOverridable,
        originalDate: inst.originalDate, overrideId: inst.overrideId,
      });
      byDay.set(key, list);
    }
  }

  const snapshot = (): AccountDaily[] =>
    accounts.map((a) => {
      const bal = running.get(a.id)!;
      const availableCredit = a.type === "CREDIT" ? (a.creditLimit ?? 0) + bal : null;
      const isExhausted = a.type === "CREDIT" ? (availableCredit as number) < 0 : bal < 0;
      return { accountId: a.id, type: a.type, balance: bal, availableCredit, isExhausted };
    });

  const combinedOf = (snap: AccountDaily[]): number =>
    snap.reduce((sum, s) => sum + (s.type === "CREDIT" ? (s.availableCredit ?? 0) : s.balance), 0);

  const days: DailyBalance[] = [];
  let cursor = replayStart;

  while (cursor <= end) {
    const key = cursor.getTime();
    const openingSnap = snapshot();
    const opening = combinedOf(openingSnap);
    const events: DailyEvent[] = [];

    for (const raw of byDay.get(key) ?? []) {
      if (raw.isSkipped) continue;
      if (skipToday && key === todayKey) continue;

      // From-account leg (negative for expense & transfer; positive for income).
      running.set(raw.accountId, (running.get(raw.accountId) ?? 0) + raw.amount);
      // Transfer destination leg: + the same magnitude.
      if (raw.toAccountId) {
        running.set(raw.toAccountId, (running.get(raw.toAccountId) ?? 0) - raw.amount);
      }

      const kind: DailyEvent["kind"] = raw.toAccountId ? "expense" : raw.amount >= 0 ? "income" : "expense";
      events.push({
        particularId: raw.particularId,
        name: raw.name,
        amount: raw.amount,
        kind,
        fromAccountId: raw.accountId,
        toAccountId: raw.toAccountId,
        isOverridden: raw.isOverridden,
        isSkipped: raw.isSkipped,
        isMovedDueToHoliday: raw.isMovedDueToHoliday,
        isOverridable: raw.isOverridable,
        originalDate: raw.originalDate,
        overrideId: raw.overrideId,
      });
    }

    const closingSnap = snapshot();
    const combined = combinedOf(closingSnap);

    if (cursor >= displayStart) {
      days.push({
        date: new Date(cursor),
        openingBalance: opening,
        closingBalance: combined,
        combined,
        accounts: closingSnap,
        events,
        isNegative: combined < 0,
      });
    }
    cursor = startOfDay(addDays(cursor, 1));
  }

  return {
    days,
    months: summarize(days),
    firstNegative: days.find((d) => d.isNegative) ?? null,
    lowest: days.length ? days.reduce((lo, c) => (c.combined < lo.combined ? c : lo)) : null,
    highest: days.length ? days.reduce((hi, c) => (c.combined > hi.combined ? c : hi)) : null,
  };
}

function summarize(days: DailyBalance[]): MonthlySummary[] {
  const map = new Map<string, MonthlySummary>();
  for (const day of days) {
    const k = `${day.date.getFullYear()}-${day.date.getMonth()}`;
    let s = map.get(k);
    if (!s) {
      s = {
        month: new Date(day.date.getFullYear(), day.date.getMonth(), 1),
        totalIncome: 0, totalExpenses: 0, netChange: 0,
        openingBalance: day.openingBalance, closingBalance: day.closingBalance,
        combinedClosing: day.combined,
        daysWithNegativeBalance: 0,
      };
      map.set(k, s);
    }
    for (const e of day.events) {
      if (e.amount > 0) s.totalIncome += e.amount;
      else s.totalExpenses += e.amount;
    }
    s.closingBalance = day.closingBalance;
    s.combinedClosing = day.combined;
    if (day.isNegative) s.daysWithNegativeBalance++;
  }
  for (const s of map.values()) s.netChange = s.totalIncome + s.totalExpenses;
  return [...map.values()].sort((a, b) => compareAsc(a.month, b.month));
}
```

Note on `openingBalance`: it is now the combined opening; `closingBalance` mirrors `combined` so existing consumers reading `closingBalance` keep working until they migrate.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/forecast.test.ts`
Expected: PASS. Then run the whole engine suite: `npx vitest run lib/engine` — fix any existing single-account tests by giving them an `accounts: [{ id, type:"DEBIT", anchorBalance, anchorDate, creditLimit:null }]` array and `accountId` on their particulars (mechanical migration; the numbers are unchanged for debit-only cases).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/forecast.ts lib/engine/forecast.test.ts lib/engine/*.test.ts
git commit -m "feat(engine): per-account replay summed into combined cash-available line"
```

---

## Task 5: Particular schema — TRANSFER validation

**Files:**
- Modify: `lib/schemas/particular.ts`
- Test: `lib/schemas/particular.test.ts`

**Interfaces:**
- Consumes: existing `particularInput`.
- Produces: `particularType` includes `"TRANSFER"`; `particularInput` accepts optional `accountId?: string` and `toAccountId?: string` with refinements: TRANSFER requires `toAccountId` and `toAccountId !== accountId`; INCOME/EXPENSE forbid `toAccountId`.

- [ ] **Step 1: Write the failing test**

Append to `lib/schemas/particular.test.ts`:

```ts
import { particularInput } from "./particular";

const base = {
  name: "x", amount: 100, frequency: "ONCE_OFF" as const,
  startDate: "2026-01-10", isCritical: true, isFixed: true, businessDayAdjustment: "NONE" as const,
};

it("TRANSFER requires a distinct toAccountId", () => {
  expect(particularInput.safeParse({ ...base, type: "TRANSFER", accountId: "a", toAccountId: "b" }).success).toBe(true);
  expect(particularInput.safeParse({ ...base, type: "TRANSFER", accountId: "a" }).success).toBe(false);
  expect(particularInput.safeParse({ ...base, type: "TRANSFER", accountId: "a", toAccountId: "a" }).success).toBe(false);
});

it("INCOME/EXPENSE must not carry a toAccountId", () => {
  expect(particularInput.safeParse({ ...base, type: "EXPENSE", toAccountId: "b" }).success).toBe(false);
  expect(particularInput.safeParse({ ...base, type: "EXPENSE" }).success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/particular.test.ts`
Expected: FAIL — `"TRANSFER"` not in the enum; no `toAccountId` field/refinement.

- [ ] **Step 3: Implement**

In `lib/schemas/particular.ts`:

```ts
export const particularType = z.enum(["INCOME", "EXPENSE", "TRANSFER"]);
```

Add to the `particularInput` object (before the closing `})`):

```ts
  accountId: z.string().optional(),
  toAccountId: z.preprocess(emptyToUndefined, z.string().optional()),
```

Add refinements after the existing `.refine(...)`:

```ts
  .refine((v) => v.type !== "TRANSFER" || (!!v.toAccountId && v.toAccountId !== v.accountId), {
    message: "Transfers need a different destination account", path: ["toAccountId"],
  })
  .refine((v) => v.type === "TRANSFER" || !v.toAccountId, {
    message: "Only transfers may set a destination account", path: ["toAccountId"],
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/schemas/particular.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/particular.ts lib/schemas/particular.test.ts
git commit -m "feat(schema): TRANSFER particular validation"
```

---

## Task 6: Account schema — credit creation & limit

**Files:**
- Modify: `lib/schemas/account.ts`
- Test: `lib/schemas/account.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `createCreditAccountInput = { name: string(1..80); creditLimit: number > 0; outstanding: number >= 0 }` — `outstanding` is the amount owed entered as a **positive** number; the router negates it for storage.
  - `updateCreditLimitInput = { creditLimit: number > 0 }`.
  - Existing `updateBalanceInput` unchanged.

- [ ] **Step 1: Write the failing test**

Create `lib/schemas/account.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createCreditAccountInput, updateCreditLimitInput } from "./account";

describe("credit account schemas", () => {
  it("accepts a valid credit account", () => {
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 5000, outstanding: 450 }).success).toBe(true);
  });
  it("rejects non-positive limit and negative outstanding", () => {
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 0, outstanding: 0 }).success).toBe(false);
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 5000, outstanding: -1 }).success).toBe(false);
  });
  it("updateCreditLimitInput requires a positive limit", () => {
    expect(updateCreditLimitInput.safeParse({ creditLimit: 100 }).success).toBe(true);
    expect(updateCreditLimitInput.safeParse({ creditLimit: -5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/schemas/account.test.ts`
Expected: FAIL — exports don't exist.

- [ ] **Step 3: Implement**

In `lib/schemas/account.ts`, add:

```ts
export const createCreditAccountInput = z.object({
  name: z.string().min(1).max(80),
  creditLimit: z.number().positive("Credit limit must be positive"),
  outstanding: z.number().min(0, "Outstanding owed cannot be negative"),
});

export const updateCreditLimitInput = z.object({
  creditLimit: z.number().positive("Credit limit must be positive"),
});

export type CreateCreditAccountInput = z.infer<typeof createCreditAccountInput>;
export type UpdateCreditLimitInput = z.infer<typeof updateCreditLimitInput>;
```

Ensure `lib/schemas/index.ts` re-exports these (it already does `export * from "./account"` — verify; if it lists named exports, add the two new ones).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/schemas/account.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/account.ts lib/schemas/account.test.ts lib/schemas/index.ts
git commit -m "feat(schema): credit account creation and limit inputs"
```

---

## Task 7: Transfer validation helper (server-pure)

**Files:**
- Create: `server/transfers.ts`
- Test: `server/transfers.test.ts`

**Interfaces:**
- Produces: `assertTransferShape(input, ownedAccountIds: Set<string>): void` — throws `TRPCError({ code: "BAD_REQUEST" })` when a TRANSFER's `toAccountId` is missing, equals `accountId`, or is not in `ownedAccountIds`; and when a non-transfer carries a `toAccountId`. No-op otherwise.

- [ ] **Step 1: Write the failing test**

Create `server/transfers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertTransferShape } from "./transfers";

const owned = new Set(["debit", "credit"]);

describe("assertTransferShape", () => {
  it("passes a valid transfer between owned accounts", () => {
    expect(() => assertTransferShape({ type: "TRANSFER", accountId: "debit", toAccountId: "credit" }, owned)).not.toThrow();
  });
  it("rejects a transfer to an unowned account", () => {
    expect(() => assertTransferShape({ type: "TRANSFER", accountId: "debit", toAccountId: "other" }, owned)).toThrow();
  });
  it("rejects a transfer to the same account", () => {
    expect(() => assertTransferShape({ type: "TRANSFER", accountId: "debit", toAccountId: "debit" }, owned)).toThrow();
  });
  it("rejects an expense carrying a destination", () => {
    expect(() => assertTransferShape({ type: "EXPENSE", accountId: "debit", toAccountId: "credit" }, owned)).toThrow();
  });
  it("passes a plain expense", () => {
    expect(() => assertTransferShape({ type: "EXPENSE", accountId: "debit", toAccountId: null }, owned)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/transfers.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `server/transfers.ts`:

```ts
import { TRPCError } from "@trpc/server";

export function assertTransferShape(
  input: { type: "INCOME" | "EXPENSE" | "TRANSFER"; accountId: string; toAccountId: string | null | undefined },
  ownedAccountIds: Set<string>,
): void {
  if (input.type === "TRANSFER") {
    if (!input.toAccountId) throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer needs a destination account" });
    if (input.toAccountId === input.accountId) throw new TRPCError({ code: "BAD_REQUEST", message: "Transfer destination must differ from source" });
    if (!ownedAccountIds.has(input.toAccountId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Destination account not found" });
  } else if (input.toAccountId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Only transfers may set a destination account" });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/transfers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/transfers.ts server/transfers.test.ts
git commit -m "feat(server): pure transfer-shape validation helper"
```

---

## Task 8: Account router — create credit & update limit

**Files:**
- Modify: `server/routers/account.ts`
- Test: `server/routers/account.test.ts`

**Interfaces:**
- Consumes: `createCreditAccountInput`, `updateCreditLimitInput`, `ensureBootstrapAccount`, `assertCan`.
- Produces:
  - `account.createCredit(input)` → creates a `FinanceAccount` with `type: "CREDIT"`, `creditLimit`, `currentBalance = -outstanding`, `balanceUpdatedAt = now`, plus an OWNER membership for the user; **rejects with BAD_REQUEST if the user already owns a CREDIT account** (one-credit cap). Returns `{ id }`.
  - `account.updateCreditLimit(input)` (accountProcedure) → sets `creditLimit`; rejects if `ctx.account.type !== "CREDIT"`. Requires `updateBalance` permission.
  - `mapMembershipToListItem` extended to return `type` and `creditLimit`.

- [ ] **Step 1: Write the failing test**

Append to `server/routers/account.test.ts` (follow the existing test harness in that file for building a caller/ctx; mirror the patterns already used there):

```ts
// Assumes the file already has helpers to create a user + authed caller.
it("createCredit makes a CREDIT account with negative outstanding", async () => {
  const { caller, userId, prisma } = await setup(); // existing harness helper
  const { id } = await caller.account.createCredit({ name: "Visa", creditLimit: 5000, outstanding: 450 });
  const acct = await prisma.financeAccount.findUnique({ where: { id } });
  expect(acct!.type).toBe("CREDIT");
  expect(Number(acct!.creditLimit)).toBe(5000);
  expect(Number(acct!.currentBalance)).toBe(-450);
  const m = await prisma.accountMembership.findFirst({ where: { userId, accountId: id } });
  expect(m!.role).toBe("OWNER");
});

it("createCredit rejects a second credit account", async () => {
  const { caller } = await setup();
  await caller.account.createCredit({ name: "Visa", creditLimit: 5000, outstanding: 0 });
  await expect(caller.account.createCredit({ name: "Mastercard", creditLimit: 1000, outstanding: 0 }))
    .rejects.toThrow();
});

it("updateCreditLimit rejects a debit account", async () => {
  const { caller, debitAccountId } = await setup();
  await expect(caller.account.updateCreditLimit({ accountId: debitAccountId, creditLimit: 999 }))
    .rejects.toThrow();
});
```

If the existing test file lacks a `setup()` helper exposing these, add a minimal one consistent with the file's current patterns (it already constructs callers for the other account tests).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routers/account.test.ts`
Expected: FAIL — `createCredit`/`updateCreditLimit` not defined.

- [ ] **Step 3: Implement**

In `server/routers/account.ts`:

Import the schemas:

```ts
import { updateBalanceInput, createCreditAccountInput, updateCreditLimitInput } from "@/lib/schemas";
```

Extend `mapMembershipToListItem`'s account param type with `type: "DEBIT" | "CREDIT"; creditLimit: unknown` and add to the returned object:

```ts
    type: m.account.type,
    creditLimit: m.account.creditLimit === null ? null : Number(m.account.creditLimit),
```

Add the procedures inside `router({ ... })`:

```ts
  createCredit: protectedProcedure.input(createCreditAccountInput).mutation(async ({ ctx, input }) => {
    await ensureBootstrapAccount(ctx.user.id);
    const existingCredit = await ctx.prisma.accountMembership.findFirst({
      where: { userId: ctx.user.id, role: "OWNER", account: { type: "CREDIT", closedAt: null } },
    });
    if (existingCredit) throw new TRPCError({ code: "BAD_REQUEST", message: "You already have a credit account" });
    const account = await ctx.prisma.financeAccount.create({
      data: {
        name: input.name, type: "CREDIT", creditLimit: input.creditLimit,
        currentBalance: -input.outstanding, balanceUpdatedAt: new Date(),
      },
    });
    await ctx.prisma.accountMembership.create({
      data: {
        userId: ctx.user.id, accountId: account.id, role: "OWNER", isDefault: false,
        canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      },
    });
    return { id: account.id };
  }),

  updateCreditLimit: accountProcedure.input(updateCreditLimitInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "updateBalance");
    if (ctx.account.type !== "CREDIT") throw new TRPCError({ code: "BAD_REQUEST", message: "Not a credit account" });
    return ctx.prisma.financeAccount.update({
      where: { id: ctx.account.id }, data: { creditLimit: input.creditLimit },
    });
  }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routers/account.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/account.ts server/routers/account.test.ts
git commit -m "feat(server): create credit account and update credit limit"
```

---

## Task 9: Particular router — transfers & reassign

**Files:**
- Modify: `server/routers/particular.ts`
- Test: `server/routers/particular.test.ts`

**Interfaces:**
- Consumes: `assertTransferShape`, `particularInput` (now with `toAccountId`), `assertCan`.
- Produces:
  - `create`/`update` persist `toAccountId` and validate via `assertTransferShape` against the set of account ids the user is a member of.
  - `reassignAccount({ id, toAccountId })` (accountProcedure on the **source** account) → moves an INCOME/EXPENSE particular to `toAccountId` (sets `accountId`) **and deletes all its overrides**, in one transaction; rejects if the particular is a TRANSFER, or if `toAccountId` is not owned by the user. Returns the updated particular.

Helper to resolve owned account ids:

```ts
async function ownedAccountIds(prisma, userId: string): Promise<Set<string>> {
  const ms = await prisma.accountMembership.findMany({
    where: { userId, account: { closedAt: null } }, select: { accountId: true },
  });
  return new Set(ms.map((m) => m.accountId));
}
```

- [ ] **Step 1: Write the failing test**

Append to `server/routers/particular.test.ts` (use the file's existing caller/ctx harness; mirror its patterns):

```ts
it("create persists a transfer with toAccountId", async () => {
  const { caller, debitId, creditId } = await setupTwoAccounts(); // create debit + credit, returns ids + caller bound to debit
  const p = await caller.particular.create({
    accountId: debitId, name: "Card payment", type: "TRANSFER", toAccountId: creditId,
    amount: 100, frequency: "ONCE_OFF", startDate: new Date("2026-01-10"),
    isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
  });
  expect(p.type).toBe("TRANSFER");
  expect(p.toAccountId).toBe(creditId);
});

it("create rejects a transfer to an unowned account", async () => {
  const { caller, debitId } = await setupTwoAccounts();
  await expect(caller.particular.create({
    accountId: debitId, name: "x", type: "TRANSFER", toAccountId: "not-owned",
    amount: 100, frequency: "ONCE_OFF", startDate: new Date("2026-01-10"),
    isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
  })).rejects.toThrow();
});

it("reassignAccount moves the particular and clears its overrides", async () => {
  const { caller, prisma, debitId, creditId } = await setupTwoAccounts();
  const p = await caller.particular.create({
    accountId: debitId, name: "Gym", type: "EXPENSE",
    amount: 50, frequency: "MONTHLY", startDate: new Date("2026-01-10"),
    isCritical: false, isFixed: false, businessDayAdjustment: "NONE",
  });
  await caller.particular.overrideInstance({
    accountId: debitId, particularId: p.id, originalDate: new Date("2026-02-10"), overriddenAmount: 60, isSkipped: false,
  });
  const moved = await caller.particular.reassignAccount({ accountId: debitId, id: p.id, toAccountId: creditId });
  expect(moved.accountId).toBe(creditId);
  const overrides = await prisma.particularOverride.findMany({ where: { particularId: p.id } });
  expect(overrides).toHaveLength(0);
});

it("reassignAccount rejects a transfer particular", async () => {
  const { caller, debitId, creditId } = await setupTwoAccounts();
  const t = await caller.particular.create({
    accountId: debitId, name: "Card payment", type: "TRANSFER", toAccountId: creditId,
    amount: 100, frequency: "ONCE_OFF", startDate: new Date("2026-01-10"),
    isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
  });
  await expect(caller.particular.reassignAccount({ accountId: debitId, id: t.id, toAccountId: creditId }))
    .rejects.toThrow();
});
```

Add a `setupTwoAccounts()` helper in the test file consistent with the existing harness: it creates the bootstrap debit account, calls `account.createCredit`, and returns `{ caller, prisma, debitId, creditId }` (the caller's `accountId` input is passed per-call, as the tests above do).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routers/particular.test.ts`
Expected: FAIL — `toAccountId` not persisted; `reassignAccount` undefined.

- [ ] **Step 3: Implement**

In `server/routers/particular.ts`:

Add imports:

```ts
import { assertTransferShape } from "../transfers";
import type { PrismaClient } from "@prisma/client";
```

Add the helper (module scope):

```ts
async function ownedAccountIds(prisma: PrismaClient, userId: string): Promise<Set<string>> {
  const ms = await prisma.accountMembership.findMany({
    where: { userId, account: { closedAt: null } }, select: { accountId: true },
  });
  return new Set(ms.map((m) => m.accountId));
}
```

In `create`, replace the body with:

```ts
  create: accountProcedure.input(particularInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editItems");
    const { accountId: _accountId, toAccountId, ...rest } = input as typeof input & { accountId?: string };
    const owned = await ownedAccountIds(ctx.prisma, ctx.user.id);
    assertTransferShape({ type: input.type, accountId: ctx.account.id, toAccountId: toAccountId ?? null }, owned);
    const created = await ctx.prisma.particular.create({
      data: {
        ...rest, category: rest.category ?? null, accountId: ctx.account.id,
        toAccountId: input.type === "TRANSFER" ? toAccountId! : null,
      },
    });
    await syncAccountCategories(ctx.prisma, ctx.account.id);
    return created;
  }),
```

In `update`, similarly thread `toAccountId`:

```ts
  update: accountProcedure.input(particularInput.and(z.object({ id: z.string() })))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.membership, "editItems");
      const { id, accountId: _a, toAccountId, ...data } = input as typeof input & { accountId?: string };
      const owned2 = await ctx.prisma.particular.findFirst({ where: { id, accountId: ctx.account.id } });
      if (!owned2) throw new TRPCError({ code: "NOT_FOUND" });
      const ownedIds = await ownedAccountIds(ctx.prisma, ctx.user.id);
      assertTransferShape({ type: input.type, accountId: ctx.account.id, toAccountId: toAccountId ?? null }, ownedIds);
      const updated = await ctx.prisma.particular.update({
        where: { id },
        data: { ...data, category: data.category ?? null, toAccountId: input.type === "TRANSFER" ? toAccountId! : null },
      });
      await syncAccountCategories(ctx.prisma, ctx.account.id);
      return updated;
    }),
```

Add `reassignAccount` (after `update`):

```ts
  reassignAccount: accountProcedure.input(z.object({ id: z.string(), toAccountId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.membership, "editItems");
      const p = await ctx.prisma.particular.findFirst({ where: { id: input.id, accountId: ctx.account.id } });
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      if (p.type === "TRANSFER") throw new TRPCError({ code: "BAD_REQUEST", message: "Transfers cannot be reassigned" });
      if (input.toAccountId === ctx.account.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Already on this account" });
      const owned = await ownedAccountIds(ctx.prisma, ctx.user.id);
      if (!owned.has(input.toAccountId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Destination account not found" });
      const updated = await ctx.prisma.$transaction(async (tx) => {
        await tx.particularOverride.deleteMany({ where: { particularId: input.id } });
        return tx.particular.update({ where: { id: input.id }, data: { accountId: input.toAccountId } });
      });
      await syncAccountCategories(ctx.prisma, ctx.account.id);
      await syncAccountCategories(ctx.prisma, input.toAccountId);
      return updated;
    }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routers/particular.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/particular.ts server/routers/particular.test.ts
git commit -m "feat(server): transfer create/update and account reassignment"
```

---

## Task 10: Forecast router — combined data across accounts

**Files:**
- Modify: `server/routers/forecast.ts`
- Test: `server/routers/forecast.test.ts` (create)

**Interfaces:**
- Consumes: `protectedProcedure`, `ensureBootstrapAccount`.
- Produces: `forecast.getCombined({ viewStart, viewEnd })` (protectedProcedure — NOT bound to one account) → returns `{ accounts: Array<{ id; name; type; currentBalance; balanceUpdatedAt; creditLimit }>; particulars: Array<Particular & { overrides }>; holidays }` for **all open accounts the user is a member of**. `windowStart` = min over accounts of `balanceUpdatedAt`, clamped to `viewStart`. Particulars/holidays gathered across those account ids; particulars use `accountId IN (...)`. The legacy `getData` (single account) stays for now.

- [ ] **Step 1: Write the failing test**

Create `server/routers/forecast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
// Reuse the harness style from server/routers/account.test.ts / particular.test.ts.

describe("forecast.getCombined", () => {
  it("returns particulars across the user's debit and credit accounts", async () => {
    const { caller, debitId, creditId } = await setupTwoAccounts();
    await caller.particular.create({
      accountId: debitId, name: "Rent", type: "EXPENSE", amount: 500, frequency: "MONTHLY",
      startDate: new Date("2026-01-01"), isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    });
    await caller.particular.create({
      accountId: creditId, name: "Subscription", type: "EXPENSE", amount: 20, frequency: "MONTHLY",
      startDate: new Date("2026-01-05"), isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    });
    const data = await caller.forecast.getCombined({ viewStart: new Date("2026-01-01"), viewEnd: new Date("2026-03-01") });
    expect(data.accounts.map((a) => a.id).sort()).toEqual([debitId, creditId].sort());
    expect(data.particulars).toHaveLength(2);
    const credit = data.accounts.find((a) => a.id === creditId)!;
    expect(credit.type).toBe("CREDIT");
    expect(credit.creditLimit).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routers/forecast.test.ts`
Expected: FAIL — `getCombined` not defined.

- [ ] **Step 3: Implement**

In `server/routers/forecast.ts`, add the import and procedure:

```ts
import { router, accountProcedure, protectedProcedure, ensureBootstrapAccount } from "../trpc";
```

```ts
  getCombined: protectedProcedure
    .input(z.object({ viewStart: z.coerce.date(), viewEnd: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      await ensureBootstrapAccount(ctx.user.id);
      const memberships = await ctx.prisma.accountMembership.findMany({
        where: { userId: ctx.user.id, account: { closedAt: null } },
        include: { account: true },
      });
      const accounts = memberships.map((m) => m.account);
      const accountIds = accounts.map((a) => a.id);
      const earliest = accounts.reduce(
        (min, a) => (a.balanceUpdatedAt < min ? a.balanceUpdatedAt : min),
        input.viewStart,
      );
      const windowStart = earliest < input.viewStart ? earliest : input.viewStart;

      const particulars = await ctx.prisma.particular.findMany({
        where: {
          accountId: { in: accountIds },
          OR: [
            { frequency: "ONCE_OFF", startDate: { gte: windowStart, lte: input.viewEnd } },
            { frequency: { not: "ONCE_OFF" }, startDate: { lte: input.viewEnd },
              OR: [{ endDate: null }, { endDate: { gte: windowStart } }] },
          ],
        },
        include: { overrides: { where: { originalDate: { gte: windowStart, lte: input.viewEnd } } } },
        orderBy: { startDate: "asc" },
      });

      const holidays = await ctx.prisma.holiday.findMany({
        where: {
          accountId: { in: accountIds },
          OR: [
            { isRecurring: false, date: { gte: windowStart, lte: input.viewEnd } },
            { isRecurring: true },
          ],
        },
        orderBy: { date: "asc" },
      });

      return {
        accounts: accounts.map((a) => ({
          id: a.id, name: a.name, type: a.type,
          currentBalance: Number(a.currentBalance), balanceUpdatedAt: a.balanceUpdatedAt,
          creditLimit: a.creditLimit === null ? null : Number(a.creditLimit),
        })),
        particulars, holidays,
      };
    }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routers/forecast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/forecast.ts server/routers/forecast.test.ts
git commit -m "feat(server): combined forecast data across a user's accounts"
```

---

## Task 11: Client engine mapper — combined payload

**Files:**
- Modify: `lib/toEngine.ts`
- Test: `lib/toEngine.test.ts` (create)

**Interfaces:**
- Consumes: the `forecast.getCombined` payload shape from Task 10.
- Produces: `toCombinedEngineInputs(data)` → `{ accounts: EngineAccount[]; particulars: EngineParticular[]; holidays: EngineHoliday[] }`. Maps each account to `EngineAccount` (debit/credit), each particular to `EngineParticular` (carrying `accountId`/`toAccountId`). Keeps the existing `toEngineInputs` for the legacy single-account path.

- [ ] **Step 1: Write the failing test**

Create `lib/toEngine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toCombinedEngineInputs } from "./toEngine";

const payload = {
  accounts: [
    { id: "debit", name: "My Account", type: "DEBIT" as const, currentBalance: 1000, balanceUpdatedAt: new Date("2026-01-01"), creditLimit: null },
    { id: "credit", name: "Visa", type: "CREDIT" as const, currentBalance: -200, balanceUpdatedAt: new Date("2026-01-01"), creditLimit: 1000 },
  ],
  particulars: [
    { id: "t", name: "Card payment", type: "TRANSFER" as const, accountId: "debit", toAccountId: "credit", amount: "100",
      frequency: "ONCE_OFF" as const, startDate: new Date("2026-01-10"), endDate: null,
      isCritical: true, isFixed: true, businessDayAdjustment: "NONE" as const, overrides: [] },
  ],
  holidays: [],
};

describe("toCombinedEngineInputs", () => {
  it("maps accounts and transfer routing", () => {
    const out = toCombinedEngineInputs(payload);
    expect(out.accounts).toHaveLength(2);
    expect(out.accounts[1]).toMatchObject({ id: "credit", type: "CREDIT", anchorBalance: -200, creditLimit: 1000 });
    expect(out.particulars[0]).toMatchObject({ accountId: "debit", toAccountId: "credit", type: "TRANSFER", amount: 100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/toEngine.test.ts`
Expected: FAIL — `toCombinedEngineInputs` not exported.

- [ ] **Step 3: Implement**

In `lib/toEngine.ts`, add (keep the existing `toEngineInputs`):

```ts
import type { EngineAccount } from "@/lib/engine";

type CombinedRow = {
  accounts: Array<{
    id: string; name: string; type: "DEBIT" | "CREDIT";
    currentBalance: number; balanceUpdatedAt: Date; creditLimit: number | null;
  }>;
  particulars: Array<{
    id: string; name: string; type: "INCOME" | "EXPENSE" | "TRANSFER"; accountId: string; toAccountId: string | null;
    amount: string | number; frequency: EngineParticular["frequency"]; startDate: Date; endDate: Date | null;
    isCritical: boolean; isFixed: boolean; businessDayAdjustment: EngineParticular["businessDayAdjustment"];
    overrides: Array<{ id: string; originalDate: Date; overriddenDate: Date | null;
      overriddenAmount: string | number | null; isSkipped: boolean }>;
  }>;
  holidays: Array<{ date: Date; isRecurring: boolean }>;
};

export function toCombinedEngineInputs(data: CombinedRow) {
  const accounts: EngineAccount[] = data.accounts.map((a) => ({
    id: a.id, type: a.type,
    anchorBalance: a.currentBalance, anchorDate: new Date(a.balanceUpdatedAt),
    creditLimit: a.creditLimit,
  }));
  const particulars: EngineParticular[] = data.particulars.map((p) => ({
    id: p.id, name: p.name, type: p.type, accountId: p.accountId, toAccountId: p.toAccountId,
    amount: Math.abs(num(p.amount)), frequency: p.frequency,
    startDate: new Date(p.startDate), endDate: p.endDate ? new Date(p.endDate) : null,
    isCritical: p.isCritical, isFixed: p.isFixed, businessDayAdjustment: p.businessDayAdjustment,
    overrides: p.overrides.map((o) => ({
      id: o.id, originalDate: new Date(o.originalDate),
      overriddenDate: o.overriddenDate ? new Date(o.overriddenDate) : null,
      overriddenAmount: o.overriddenAmount === null ? null : Math.abs(num(o.overriddenAmount)),
      isSkipped: o.isSkipped,
    })),
  }));
  const holidays: EngineHoliday[] = data.holidays.map((h) => ({ date: new Date(h.date), isRecurring: h.isRecurring }));
  return { accounts, particulars, holidays };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/toEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/toEngine.ts lib/toEngine.test.ts
git commit -m "feat(client): map combined forecast payload to engine inputs"
```

---

## Task 12: Dashboard — combined line wired to getCombined

**Files:**
- Modify: `app/page.tsx`
- Test: manual (UI) — see Step 4. No new unit test; covered by the engine/router tests above.

**Interfaces:**
- Consumes: `forecast.getCombined`, `toCombinedEngineInputs`, `computeForecast`.
- Produces: the dashboard's metrics/sparkline/daily cards driven by the combined `ForecastResult` (`days[i].combined`). Account-name lookup map for transfer labels (Task 13 renders the label).

- [ ] **Step 1: Switch the query**

In `app/page.tsx`, replace the `forecast.getData` query with `getCombined` (no `accountId`):

```ts
const { data, isLoading } = trpc.forecast.getCombined.useQuery(
  { viewStart, viewEnd },
  { placeholderData: keepPreviousData },
);
```

Replace `toEngineInputs(data)` usage with:

```ts
import { toCombinedEngineInputs } from "@/lib/toEngine";
// ...
const engineInputs = useMemo(
  () => (data ? toCombinedEngineInputs(data) : null),
  [data],
);
const forecast = useMemo(
  () => (engineInputs ? computeForecast({ ...engineInputs, viewStart, viewEnd, today, skipToday }) : null),
  [engineInputs, viewStart, viewEnd, today, skipToday],
);
```

Build an account-name map for labels:

```ts
const accountNames = useMemo(
  () => new Map((data?.accounts ?? []).map((a) => [a.id, a.name])),
  [data],
);
```

Where the UI reads `day.closingBalance`, it continues to work (closingBalance mirrors combined). Update the headline metric to read from `forecast.days`/`forecast.lowest`/`forecast.highest` as before — the shapes are unchanged except for the added `combined`/`accounts` fields.

- [ ] **Step 2: Adjust the optimistic balance update**

The `account.updateBalance` mutation's `onSettled` should invalidate the combined query:

```ts
onSettled: () => { utils.account.list.invalidate(); utils.forecast.getCombined.invalidate(); },
```

(Keep `getData.invalidate()` too if other views still use it; otherwise replace.)

> **Other invalidation sites:** `app/holidays/page.tsx` and `app/budget/page.tsx` call `utils.forecast.getData.invalidate()`. Since the dashboard now reads `getCombined`, add `utils.forecast.getCombined.invalidate()` alongside the existing `getData.invalidate()` in those files' mutation `onSettled` handlers so edits there refresh the combined dashboard. Do this as part of this task. The legacy `getData` endpoint stays (still used elsewhere).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `app/page.tsx`. Fix any references to removed `anchorBalance`/`anchorDate`.

- [ ] **Step 4: Manual smoke**

Start a dev server on a free port per the project memory (`npx next dev -p 3105`), open the dashboard, confirm the line renders for a debit-only user (numbers unchanged from before). 

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/holidays/page.tsx app/budget/page.tsx
git commit -m "feat(dashboard): drive combined forecast from getCombined across accounts"
```

---

## Task 13: Dashboard — transfer label & per-account flags

**Files:**
- Modify: `app/_components/dashboard/DailyCard.tsx` (and the event row component it uses)
- Test: component test if the file has a sibling test; otherwise manual.

**Interfaces:**
- Consumes: `DailyEvent` with `fromAccountId`/`toAccountId`; an `accountNames: Map<string,string>` prop threaded from `app/page.tsx`.
- Produces: a transfer event renders its name as `[from name] -> [to name]`; per-account exhaustion (a day where any `accounts[i].isExhausted`) shows the existing danger styling.

- [ ] **Step 1: Thread the account-name map**

In `app/page.tsx`, pass `accountNames` down to `DailyCard` (and through to the event row). Add the prop to `DailyCard`'s props type.

- [ ] **Step 2: Render the transfer label**

In the event-row render, when `event.toAccountId` is set:

```tsx
const label = event.toAccountId
  ? `${accountNames.get(event.fromAccountId) ?? "?"} -> ${accountNames.get(event.toAccountId) ?? "?"}`
  : event.name;
```

Use `label` where the event name is displayed.

- [ ] **Step 3: Typecheck + manual**

Run: `npx tsc --noEmit` (expect no errors). Create a transfer in the UI (after Task 14) and confirm it shows `Debit -> Visa`.

- [ ] **Step 4: Commit**

```bash
git add app/_components/dashboard/DailyCard.tsx app/page.tsx
git commit -m "feat(dashboard): render transfers as [from] -> [to]"
```

---

## Task 14: Particular form — transfer type & account selectors

**Files:**
- Modify: `app/particulars/ParticularForm.tsx`
- Modify: `lib/schemas/toParticularInput.ts` (carry `toAccountId`, accept `TRANSFER`) + `lib/schemas/toParticularInput.test.ts`

**Interfaces:**
- Consumes: `account.list` (to populate from/to selectors), `particular.create`/`update`.
- Produces: form supports `type = TRANSFER`, revealing **from** and **to** account selects (must differ); critical/flexible/recurrence/override controls remain. `toParticularInput` round-trips `toAccountId` and the `TRANSFER` type.

- [ ] **Step 1: Update `toParticularInput` (test first)**

Append to `lib/schemas/toParticularInput.test.ts`:

```ts
it("carries TRANSFER type and toAccountId", () => {
  const out = toParticularInput({
    name: "Card payment", type: "TRANSFER", amount: 100, frequency: "ONCE_OFF",
    startDate: "2026-01-10", endDate: null, isCritical: true, isFixed: true,
    businessDayAdjustment: "NONE", category: null, accountId: "debit", toAccountId: "credit",
  } as never);
  expect(out.type).toBe("TRANSFER");
  expect((out as { toAccountId?: string }).toAccountId).toBe("credit");
});
```

Run: `npx vitest run lib/schemas/toParticularInput.test.ts` → FAIL.

Update `StoredParticular` type and `toParticularInput` in `lib/schemas/toParticularInput.ts`: add `type` union member `"TRANSFER"`, add optional `accountId?: string | null` and `toAccountId?: string | null` to `StoredParticular`, and include `toAccountId: p.toAccountId ?? undefined` in the returned object.

Run again → PASS.

- [ ] **Step 2: Form UI**

In `app/particulars/ParticularForm.tsx`:
- Add `TRANSFER` to the type selector options.
- Query `account.list`; render a **from** account select (defaults to the active account) and, when `type === "TRANSFER"`, a **to** account select listing the *other* accounts. Validate to ≠ from client-side (mirror the schema message).
- Include `accountId`/`toAccountId` in the submit payload. For INCOME/EXPENSE, omit `toAccountId`.
- Keep critical/flexible/recurrence controls visible for TRANSFER (override controls live in the existing override management UI and are unchanged).

- [ ] **Step 3: Typecheck + manual**

Run: `npx tsc --noEmit`. Manually create a transfer (Debit → Visa, $100, monthly) and confirm it appears on the dashboard as `Debit -> Visa` and nets to zero on the combined line.

- [ ] **Step 4: Commit**

```bash
git add app/particulars/ParticularForm.tsx lib/schemas/toParticularInput.ts lib/schemas/toParticularInput.test.ts
git commit -m "feat(form): transfer type with from/to account selectors"
```

---

## Task 15: Add-credit-account flow & limit editing

**Files:**
- Create: `app/_components/account/AddCreditAccountDialog.tsx`
- Modify: the account menu/settings component that lists accounts (the consumer of `useActiveAccount`/`account.list`) to add an "Add credit account" entry and a credit-limit editor.

**Interfaces:**
- Consumes: `account.createCredit`, `account.updateCreditLimit`, `account.list` (now returns `type`/`creditLimit`).
- Produces: a dialog collecting name + credit limit + outstanding owed; on submit calls `createCredit`, invalidates `account.list` and `forecast.getCombined`. The action is hidden/disabled when the user already owns a credit account (list contains one with `type === "CREDIT"`). A credit-limit editor calls `updateCreditLimit`.

- [ ] **Step 1: Build the dialog**

Create `app/_components/account/AddCreditAccountDialog.tsx` following the existing dialog/form patterns (Radix/shadcn). Fields: `name` (text), `creditLimit` (number > 0), `outstanding` (number ≥ 0). On submit:

```ts
const create = trpc.account.createCredit.useMutation({
  onSuccess: () => { utils.account.list.invalidate(); utils.forecast.getCombined.invalidate(); onClose(); },
});
```

- [ ] **Step 2: Wire into the account menu**

In the account-list/menu component, add an "Add credit account" button that opens the dialog, shown only when no `type === "CREDIT"` account exists in `account.list`. Add an inline credit-limit editor (number input + save) for credit accounts that calls `account.updateCreditLimit`.

- [ ] **Step 3: Typecheck + manual**

Run: `npx tsc --noEmit`. Manually: add a credit account (limit 5000, outstanding 450); confirm the combined line jumps by `availableCredit = 5000 − 450 = 4550`; confirm a second "Add credit account" is hidden; edit the limit and confirm the line moves.

- [ ] **Step 4: Commit**

```bash
git add app/_components/account/AddCreditAccountDialog.tsx app/_components
git commit -m "feat(account): add credit account flow and credit-limit editing"
```

---

## Task 16: Reassign-account action with override-clear warning

**Files:**
- Create/Modify: the particular row/menu component under `app/particulars/` that exposes per-item actions.

**Interfaces:**
- Consumes: `particular.reassignAccount`, `account.list`.
- Produces: a "Move to account" action on INCOME/EXPENSE rows (hidden for TRANSFER) → confirm dialog warning "All overrides on this item will be cleared." → on confirm calls `reassignAccount({ accountId: currentAccountId, id, toAccountId })`, optimistically removing the row from the current account's list (consistent with existing optimistic-list patterns on this branch), then invalidates `particular.list` and `forecast.getCombined`.

- [ ] **Step 1: Add the action + confirm dialog**

In the particular row actions, add "Move to account" (only when `type !== "TRANSFER"`). Open a confirm dialog listing the other accounts as the destination and the warning text. On confirm:

```ts
const reassign = trpc.particular.reassignAccount.useMutation({
  onSettled: () => { utils.particular.list.invalidate(); utils.forecast.getCombined.invalidate(); },
});
```

Apply the optimistic list removal using the existing `lib/optimistic` helpers used elsewhere on this branch.

- [ ] **Step 2: Typecheck + manual**

Run: `npx tsc --noEmit`. Manually: create an expense with an override, move it to the credit account, confirm the warning appears, confirm after moving the override is gone and the item now affects the credit account's available credit.

- [ ] **Step 3: Commit**

```bash
git add app/particulars
git commit -m "feat(particulars): move-to-account action clears overrides with warning"
```

---

## Task 17: Full suite & typecheck

**Files:** none (verification task).

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all green. Fix any single-account engine/router tests still using the old `anchorBalance`/`getData` shape by migrating them to `accounts`/`getCombined`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit (if fixes were needed)**

```bash
git add -A
git commit -m "test: migrate remaining single-account tests to combined forecast"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** account model (T1, T8, T15) · particular ownership + transfer one-row-two-FK (T1, T5, T9) · engine per-account replay + combined line + soft limit (T2–T4) · transfer overrides same gating (engine in T4 honours instance overrides; schema/server gating reused — override endpoint unchanged, already enforces gating) · server (T8–T10) · client/dashboard (T11–T16) · testing (every engine/schema/server task is TDD; T17 is the full gate).
- **Reassign clears overrides:** T9 (server transaction) + T16 (UI warning).
- **`[from] -> [to]` label:** T13.
- **One-credit cap in router/UI, not DB:** T8 (router) + T15 (UI), matching the spec's "model permits more."
- **Type consistency:** `toCombinedEngineInputs`, `getCombined`, `assertTransferShape`, `reassignAccount`, `createCredit`, `updateCreditLimit`, `AccountDaily`, `EngineAccount` used identically across tasks.
