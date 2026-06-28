# Future Finance v2 — Core Forecast Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean, single-user financial forecaster as one Next.js app: a pure forecast engine, a tRPC + Prisma + NextAuth API mounted on App Router route handlers, and a faithful port of the original UX.

**Architecture:** One Next.js (App Router) app at the repo root. A pure `lib/engine/` (no React, no DB, deterministic) is imported by both the server and the dashboard client component (for instant local recompute). tRPC 11 is mounted via an App Router fetch route handler; NextAuth v5 provides auth; Prisma 7 talks to Postgres. The forecast always replays from the account's `balanceUpdatedAt` (seeded with `currentBalance`) forward to the visible window, then slices for display.

**Tech Stack:** TypeScript, Next.js 16 (App Router), React 19, Vitest, tRPC 11, Prisma 7, PostgreSQL, NextAuth v5 (`5.0.0-beta.31`), Tailwind v4, Radix/shadcn UI, Zod 4, React Query 5, date-fns, recharts, lucide-react, next-themes.

**Source spec:** `docs/superpowers/specs/2026-06-28-future-finance-v2-core-forecast-design.md`

## Global Constraints

- The Next.js app lives at the **repo root** (`app/`, `server/`, `lib/`, `prisma/`). The `baseline/` folder is the source for the theme port and is left in place.
- `lib/engine/` and `lib/schemas/` MUST NOT import React, Prisma, Next, or any DB/runtime client. Engine functions are deterministic: "today" and "skip today" are passed in as parameters, never read from the clock.
- `server/` is server-only — never imported into a client component bundle. Client components reach the server only through tRPC.
- Sign convention: `Particular.amount` is stored **positive** in the DB; the sign is applied from `type` (INCOME = +, EXPENSE = −) inside the engine.
- Overrides are matched to instances by `(particularId, originalDate)` using a UTC year/month/day compare (ignore time).
- One `FinanceAccount` per user, enforced by `ownerId @unique`. Do not add multi-account, collaboration, or debt models.
- Forecast default horizon: today → +3 months, with load-more appending one month.
- Currency formatting: NZD via `Intl.NumberFormat('en-NZ', ...)`.
- Every tRPC procedure is `protectedProcedure` scoped to the caller's single account.
- NextAuth v5 is the beta (`5.0.0-beta.31`) — this is intentional; there is no stable v5.
- Test runner is Vitest everywhere. No Playwright in this slice.
- TDD: write the failing test, see it fail, implement minimally, see it pass, commit.

---

## File Structure

```
/  (repo root = the Next.js app)
  package.json                 next, react, trpc, prisma, vitest, etc.
  next.config.ts
  tsconfig.json                paths: @/* -> ./, strict, noUncheckedIndexedAccess
  vitest.config.ts             include lib/**, server/**, app/** unit tests
  postcss.config.mjs           @tailwindcss/postcss
  .env.example
  prisma/
    schema.prisma              User, FinanceAccount, Particular, ParticularOverride, Holiday, + Auth.js
  lib/
    engine/
      types.ts                 Engine* plain types
      dates.ts                 isBusinessDay, adjustToBusinessDay, expandRecurringHolidays
      instances.ts             generateInstances
      forecast.ts              computeForecast (+ monthly/lowest/firstNegative)
      index.ts                 re-exports
      *.test.ts                vitest unit tests (co-located)
    schemas/
      particular.ts            Zod schemas shared client+server
      holiday.ts
      account.ts
      index.ts
    design-system.ts           helpers only (formatCurrency, color classes, etc.)
    utils.ts                   cn() for shadcn components
    toEngine.ts                forecast.getData rows -> engine inputs (client+server safe)
  server/                      SERVER-ONLY
    db.ts                      Prisma client singleton
    auth.ts                    NextAuth v5 config + auth() helper
    trpc.ts                    tRPC init, context, protectedProcedure, resolveAccount
    mappers.ts                 Prisma rows -> Engine* types
    routers/
      account.ts, holiday.ts, particular.ts, forecast.ts
      _app.ts                  appRouter (root) + AppRouter type export
  app/
    layout.tsx                 root layout: <html>, providers, theme
    globals.css                ported theme tokens
    providers.tsx              "use client": tRPC + React Query + theme providers
    api/
      trpc/[trpc]/route.ts     tRPC fetch handler
      auth/[...nextauth]/route.ts  NextAuth handlers
    page.tsx                   Dashboard (client component; runs engine locally)
    _components/               app shell + dashboard widgets
      Layout.tsx, Sidebar.tsx, BottomNav.tsx
      theme-toggle.tsx
      ui/*                     ported shadcn primitives
      dashboard/MetricCard.tsx, DailyCard.tsx, OverrideModal.tsx,
                DangerNotification.tsx, BalanceSparkline.tsx,
                UpdateBalanceModal.tsx, SkipTodayButton.tsx
    particulars/page.tsx       + ParticularForm.tsx, OverrideManagement.tsx
    holidays/page.tsx
    login/page.tsx
    _providers/ActiveAccountProvider.tsx
  trpc/
    client.ts                  createTRPCReact<AppRouter>()
```

---

## Phase 1 — Repo scaffold & engine (the testable heart)

### Task 1: Scaffold the Next.js app root + engine package with Vitest

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `lib/engine/index.ts`
- Test: `lib/engine/smoke.test.ts`

**Interfaces:**
- Produces: a working `npm test` (Vitest) at the repo root that discovers `lib/**/*.test.ts`, and `ENGINE_VERSION` from `lib/engine/index`.

- [ ] **Step 1: Write the failing smoke test**

`lib/engine/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("engine package", () => {
  it("exposes a version constant", () => {
    expect(ENGINE_VERSION).toBe("v2");
  });
});
```

- [ ] **Step 2: Create root config files**

`package.json`:
```json
{
  "name": "future-finance-v2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest",
    "typecheck": "tsc --noEmit",
    "db:push": "prisma db push",
    "db:generate": "prisma generate"
  },
  "dependencies": {
    "next": "16.2.9",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "@trpc/server": "11.18.0",
    "@trpc/client": "11.18.0",
    "@trpc/react-query": "11.18.0",
    "@tanstack/react-query": "5.101.2",
    "@prisma/client": "7.8.0",
    "next-auth": "5.0.0-beta.31",
    "@auth/prisma-adapter": "2.11.2",
    "zod": "4.4.3",
    "superjson": "2.2.6",
    "date-fns": "4.4.0",
    "react-hook-form": "7.80.0",
    "@hookform/resolvers": "5.4.0",
    "lucide-react": "1.21.0",
    "recharts": "3.9.0",
    "next-themes": "0.4.6",
    "clsx": "2.1.1",
    "tailwind-merge": "2.5.5",
    "class-variance-authority": "0.7.1"
  },
  "devDependencies": {
    "typescript": "5.9.3",
    "@types/node": "22.10.0",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "vitest": "4.1.9",
    "prisma": "7.8.0",
    "tailwindcss": "4.3.1",
    "@tailwindcss/postcss": "4.3.1",
    "tw-animate-css": "1.4.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "incremental": true,
    "allowJs": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "types": ["vitest/globals", "node"],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { globals: true, environment: "node", include: ["lib/**/*.test.ts", "server/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

- [ ] **Step 3: Implement minimal engine index**

`lib/engine/index.ts`:
```ts
export const ENGINE_VERSION = "v2" as const;
```

- [ ] **Step 4: Install and run the test**

Run (from repo root): `npm install && npm test -- run lib/engine/smoke.test.ts`
Expected: PASS (1 test). (If you ran the test before Step 2/3, it FAILS with "cannot find module ./index" — that is the expected red state.)

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts lib/engine package-lock.json
git commit -m "chore: scaffold next.js app root and engine package with vitest"
```

---

### Task 2: Engine types

**Files:**
- Create: `lib/engine/types.ts`
- Modify: `lib/engine/index.ts` (add export)
- Test: `lib/engine/types.test.ts`

**Interfaces:**
- Produces:
  - `type Frequency = 'ONCE_OFF'|'WEEKLY'|'FORTNIGHTLY'|'MONTHLY'|'ANNUAL'`
  - `type BdaAdjustment = 'NONE'|'NEXT_BUSINESS_DAY'|'PREVIOUS_BUSINESS_DAY'`
  - `type ParticularType = 'INCOME'|'EXPENSE'`
  - `EngineOverride { id:string; originalDate:Date; overriddenDate:Date|null; overriddenAmount:number|null; isSkipped:boolean }`
  - `EngineParticular { id:string; name:string; type:ParticularType; amount:number; frequency:Frequency; startDate:Date; endDate:Date|null; isCritical:boolean; isFixed:boolean; businessDayAdjustment:BdaAdjustment; overrides:EngineOverride[] }`
  - `EngineHoliday { date:Date; isRecurring:boolean }`
  - `Instance { date:Date; amount:number; isOverridden:boolean; isSkipped:boolean; isMovedDueToHoliday:boolean; originalDate?:Date; overrideId?:string }`
  - `DailyEvent { particularId:string; name:string; amount:number; kind:'income'|'expense'; isOverridden:boolean; isSkipped:boolean; isMovedDueToHoliday:boolean; originalDate?:Date }`
  - `DailyBalance { date:Date; openingBalance:number; closingBalance:number; events:DailyEvent[]; isNegative:boolean }`
  - `MonthlySummary { month:Date; totalIncome:number; totalExpenses:number; netChange:number; openingBalance:number; closingBalance:number; daysWithNegativeBalance:number }`

- [ ] **Step 1: Write the failing test**

`lib/engine/types.test.ts`:
```ts
import { describe, it, expectTypeOf } from "vitest";
import type { EngineParticular, DailyBalance } from "./types";

describe("engine types", () => {
  it("EngineParticular carries amount as a number", () => {
    expectTypeOf<EngineParticular["amount"]>().toEqualTypeOf<number>();
  });
  it("DailyBalance carries closingBalance as a number", () => {
    expectTypeOf<DailyBalance["closingBalance"]>().toEqualTypeOf<number>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run lib/engine/types.test.ts`
Expected: FAIL — cannot find module `./types`.

- [ ] **Step 3: Implement the types**

`lib/engine/types.ts`:
```ts
export type Frequency = "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL";
export type BdaAdjustment = "NONE" | "NEXT_BUSINESS_DAY" | "PREVIOUS_BUSINESS_DAY";
export type ParticularType = "INCOME" | "EXPENSE";

export interface EngineOverride {
  id: string;
  originalDate: Date;
  overriddenDate: Date | null;
  overriddenAmount: number | null;
  isSkipped: boolean;
}

export interface EngineParticular {
  id: string;
  name: string;
  type: ParticularType;
  amount: number; // always positive; sign applied from type
  frequency: Frequency;
  startDate: Date;
  endDate: Date | null;
  isCritical: boolean;
  isFixed: boolean;
  businessDayAdjustment: BdaAdjustment;
  overrides: EngineOverride[];
}

export interface EngineHoliday {
  date: Date;
  isRecurring: boolean;
}

export interface Instance {
  date: Date;
  amount: number; // signed
  isOverridden: boolean;
  isSkipped: boolean;
  isMovedDueToHoliday: boolean;
  originalDate?: Date;
  overrideId?: string;
}

export interface DailyEvent {
  particularId: string;
  name: string;
  amount: number; // signed
  kind: "income" | "expense";
  isOverridden: boolean;
  isSkipped: boolean;
  isMovedDueToHoliday: boolean;
  originalDate?: Date;
}

export interface DailyBalance {
  date: Date;
  openingBalance: number;
  closingBalance: number;
  events: DailyEvent[];
  isNegative: boolean;
}

export interface MonthlySummary {
  month: Date;
  totalIncome: number;
  totalExpenses: number;
  netChange: number;
  openingBalance: number;
  closingBalance: number;
  daysWithNegativeBalance: number;
}
```

`lib/engine/index.ts` (append):
```ts
export * from "./types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/engine/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/types.ts lib/engine/types.test.ts lib/engine/index.ts
git commit -m "feat(engine): add plain engine types"
```

---

### Task 3: Date helpers (business day + holiday expansion)

**Files:**
- Create: `lib/engine/dates.ts`
- Modify: `lib/engine/index.ts` (add export)
- Test: `lib/engine/dates.test.ts`

**Interfaces:**
- Consumes: `EngineHoliday`, `BdaAdjustment` from `./types`.
- Produces:
  - `isBusinessDay(date: Date, holidays: EngineHoliday[]): boolean`
  - `adjustToBusinessDay(date: Date, adjustment: BdaAdjustment, holidays: EngineHoliday[]): Date`
  - `expandRecurringHolidays(holidays: EngineHoliday[], start: Date, end: Date): Date[]`

- [ ] **Step 1: Write the failing tests**

`lib/engine/dates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isBusinessDay, adjustToBusinessDay } from "./dates";
import type { EngineHoliday } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");

describe("isBusinessDay", () => {
  it("returns false on a Saturday", () => {
    expect(isBusinessDay(d("2026-06-27"), [])).toBe(false); // Sat
  });
  it("returns false on a Sunday", () => {
    expect(isBusinessDay(d("2026-06-28"), [])).toBe(false); // Sun
  });
  it("returns true on a weekday with no holiday", () => {
    expect(isBusinessDay(d("2026-06-29"), [])).toBe(true); // Mon
  });
  it("returns false on a one-time holiday", () => {
    const h: EngineHoliday[] = [{ date: d("2026-06-29"), isRecurring: false }];
    expect(isBusinessDay(d("2026-06-29"), h)).toBe(false);
  });
  it("returns false on a recurring holiday (month+day, any year)", () => {
    const h: EngineHoliday[] = [{ date: d("2000-12-25"), isRecurring: true }];
    expect(isBusinessDay(d("2026-12-25"), h)).toBe(false);
  });
});

describe("adjustToBusinessDay", () => {
  it("NONE leaves the date unchanged", () => {
    expect(adjustToBusinessDay(d("2026-06-27"), "NONE", []).getTime())
      .toBe(d("2026-06-27").getTime());
  });
  it("NEXT_BUSINESS_DAY moves Saturday to Monday", () => {
    expect(adjustToBusinessDay(d("2026-06-27"), "NEXT_BUSINESS_DAY", []).getTime())
      .toBe(d("2026-06-29").getTime());
  });
  it("PREVIOUS_BUSINESS_DAY moves Sunday to Friday", () => {
    expect(adjustToBusinessDay(d("2026-06-28"), "PREVIOUS_BUSINESS_DAY", []).getTime())
      .toBe(d("2026-06-26").getTime());
  });
  it("skips over a holiday adjacent to the weekend", () => {
    const h: EngineHoliday[] = [{ date: d("2026-06-29"), isRecurring: false }];
    // Sat -> Mon is holiday -> Tue
    expect(adjustToBusinessDay(d("2026-06-27"), "NEXT_BUSINESS_DAY", h).getTime())
      .toBe(d("2026-06-30").getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run lib/engine/dates.test.ts`
Expected: FAIL — cannot find module `./dates`.

- [ ] **Step 3: Implement the date helpers**

`lib/engine/dates.ts`:
```ts
import { addDays, isWeekend, isSameDay, getYear, getMonth, getDate } from "date-fns";
import type { EngineHoliday, BdaAdjustment } from "./types";

export function isBusinessDay(date: Date, holidays: EngineHoliday[]): boolean {
  if (isWeekend(date)) return false;
  const isHoliday = holidays.some((h) =>
    h.isRecurring
      ? getMonth(h.date) === getMonth(date) && getDate(h.date) === getDate(date)
      : isSameDay(h.date, date)
  );
  return !isHoliday;
}

export function adjustToBusinessDay(
  date: Date,
  adjustment: BdaAdjustment,
  holidays: EngineHoliday[]
): Date {
  if (adjustment === "NONE") return date;
  const stepDir = adjustment === "NEXT_BUSINESS_DAY" ? 1 : -1;
  let d = date;
  while (!isBusinessDay(d, holidays)) d = addDays(d, stepDir);
  return d;
}

export function expandRecurringHolidays(
  holidays: EngineHoliday[],
  start: Date,
  end: Date
): Date[] {
  const out: Date[] = [];
  for (const h of holidays) {
    if (h.isRecurring) {
      for (let y = getYear(start); y <= getYear(end); y++) {
        const inst = new Date(y, getMonth(h.date), getDate(h.date));
        if (inst >= start && inst <= end) out.push(inst);
      }
    } else if (h.date >= start && h.date <= end) {
      out.push(h.date);
    }
  }
  return out;
}
```

`lib/engine/index.ts` (append):
```ts
export * from "./dates";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/engine/dates.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/dates.ts lib/engine/dates.test.ts lib/engine/index.ts
git commit -m "feat(engine): business-day and holiday date helpers"
```

---

### Task 4: Instance generation (recurrence + overrides + business-day)

**Files:**
- Create: `lib/engine/instances.ts`
- Modify: `lib/engine/index.ts` (add export)
- Test: `lib/engine/instances.test.ts`

**Interfaces:**
- Consumes: `EngineParticular`, `EngineHoliday`, `EngineOverride`, `Instance` from `./types`; `adjustToBusinessDay` from `./dates`.
- Produces: `generateInstances(p: EngineParticular, viewStart: Date, viewEnd: Date, holidays: EngineHoliday[]): Instance[]`
  - Emits **signed** amounts (EXPENSE negated). Steps recurrence from `startDate`. Applies overrides (skip / amount / date) matched by UTC date. Applies business-day adjustment only when there is no `overriddenDate`.

- [ ] **Step 1: Write the failing tests**

`lib/engine/instances.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateInstances } from "./instances";
import type { EngineParticular } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");
const base: EngineParticular = {
  id: "p1", name: "Test", type: "EXPENSE", amount: 100,
  frequency: "ONCE_OFF", startDate: d("2026-07-10"), endDate: null,
  isCritical: true, isFixed: true, businessDayAdjustment: "NONE", overrides: [],
};

describe("generateInstances", () => {
  it("once-off in range produces one signed (negative) instance", () => {
    const r = generateInstances(base, d("2026-07-01"), d("2026-07-31"), []);
    expect(r).toHaveLength(1);
    expect(r[0]!.amount).toBe(-100);
  });

  it("once-off outside range produces nothing", () => {
    const r = generateInstances(base, d("2026-08-01"), d("2026-08-31"), []);
    expect(r).toHaveLength(0);
  });

  it("income keeps positive sign", () => {
    const r = generateInstances({ ...base, type: "INCOME" }, d("2026-07-01"), d("2026-07-31"), []);
    expect(r[0]!.amount).toBe(100);
  });

  it("weekly recurrence emits the right count", () => {
    const p = { ...base, frequency: "WEEKLY" as const, startDate: d("2026-07-01") };
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-29"), []);
    // Jul 1, 8, 15, 22, 29 => 5
    expect(r).toHaveLength(5);
  });

  it("monthly recurrence respects endDate", () => {
    const p = { ...base, frequency: "MONTHLY" as const, startDate: d("2026-07-15"), endDate: d("2026-09-15") };
    const r = generateInstances(p, d("2026-01-01"), d("2026-12-31"), []);
    expect(r.map(i => i.date.getMonth())).toEqual([6, 7, 8]); // Jul, Aug, Sep
  });

  it("skip override yields a skipped, zero-amount instance", () => {
    const p = {
      ...base, frequency: "WEEKLY" as const, isCritical: false,
      overrides: [{ id: "o1", originalDate: d("2026-07-08"), overriddenDate: null, overriddenAmount: null, isSkipped: true }],
    };
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-15"), []);
    const skipped = r.find(i => i.isSkipped);
    expect(skipped).toBeDefined();
    expect(skipped!.amount).toBe(0);
  });

  it("amount override replaces the amount (signed)", () => {
    const p = {
      ...base, frequency: "WEEKLY" as const, isFixed: false,
      overrides: [{ id: "o2", originalDate: d("2026-07-08"), overriddenDate: null, overriddenAmount: 250, isSkipped: false }],
    };
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-15"), []);
    const ov = r.find(i => i.isOverridden);
    expect(ov!.amount).toBe(-250); // expense stays negative
  });

  it("date override moves the instance and suppresses business-day adjustment", () => {
    const p = {
      ...base, frequency: "WEEKLY" as const, isCritical: false, businessDayAdjustment: "NEXT_BUSINESS_DAY" as const,
      overrides: [{ id: "o3", originalDate: d("2026-07-08"), overriddenDate: d("2026-07-09"), overriddenAmount: null, isSkipped: false }],
    };
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-15"), []);
    const moved = r.find(i => i.overrideId === "o3");
    expect(moved!.date.getTime()).toBe(d("2026-07-09").getTime());
  });

  it("business-day adjustment moves a weekend instance and flags it", () => {
    const p = { ...base, frequency: "ONCE_OFF" as const, startDate: d("2026-07-11"), businessDayAdjustment: "NEXT_BUSINESS_DAY" as const }; // Sat
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-31"), []);
    expect(r[0]!.date.getTime()).toBe(d("2026-07-13").getTime()); // Mon
    expect(r[0]!.isMovedDueToHoliday).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run lib/engine/instances.test.ts`
Expected: FAIL — cannot find module `./instances`.

- [ ] **Step 3: Implement instance generation**

`lib/engine/instances.ts`:
```ts
import { addWeeks, addMonths, addYears, isSameDay } from "date-fns";
import { adjustToBusinessDay } from "./dates";
import type { EngineParticular, EngineHoliday, EngineOverride, Instance } from "./types";

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function findOverride(overrides: EngineOverride[], date: Date): EngineOverride | undefined {
  return overrides.find((o) => sameUtcDay(o.originalDate, date));
}

function signed(type: EngineParticular["type"], amount: number): number {
  return type === "EXPENSE" ? -Math.abs(amount) : Math.abs(amount);
}

function step(date: Date, freq: EngineParticular["frequency"]): Date {
  switch (freq) {
    case "WEEKLY": return addWeeks(date, 1);
    case "FORTNIGHTLY": return addWeeks(date, 2);
    case "MONTHLY": return addMonths(date, 1);
    case "ANNUAL": return addYears(date, 1);
    default: return date;
  }
}

export function generateInstances(
  p: EngineParticular,
  viewStart: Date,
  viewEnd: Date,
  holidays: EngineHoliday[]
): Instance[] {
  const out: Instance[] = [];

  const emit = (occurrence: Date) => {
    const override = findOverride(p.overrides, occurrence);

    if (override?.isSkipped) {
      out.push({
        date: occurrence, amount: 0, isOverridden: true, isSkipped: true,
        isMovedDueToHoliday: false, originalDate: occurrence, overrideId: override.id,
      });
      return;
    }

    const effectiveDate = override?.overriddenDate
      ?? adjustToBusinessDay(occurrence, p.businessDayAdjustment, holidays);
    const rawAmount = override?.overriddenAmount ?? p.amount;
    const isMoved = !override?.overriddenDate && !isSameDay(occurrence, effectiveDate);

    out.push({
      date: effectiveDate,
      amount: signed(p.type, rawAmount),
      isOverridden: !!override,
      isSkipped: false,
      isMovedDueToHoliday: isMoved,
      originalDate: occurrence,
      overrideId: override?.id,
    });
  };

  if (p.frequency === "ONCE_OFF") {
    if (p.startDate >= viewStart && p.startDate <= viewEnd) emit(p.startDate);
    return out;
  }

  let current = p.startDate;
  const hardEnd = p.endDate ?? viewEnd;
  while (current <= hardEnd && current <= viewEnd) {
    if (current >= viewStart) emit(current);
    current = step(current, p.frequency);
  }
  return out;
}
```

`lib/engine/index.ts` (append):
```ts
export * from "./instances";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/engine/instances.test.ts`
Expected: PASS (all 9 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/instances.ts lib/engine/instances.test.ts lib/engine/index.ts
git commit -m "feat(engine): instance generation with recurrence, overrides, business-day"
```

---

### Task 5: Anchored forecast replay + monthly/lowest/first-negative

**Files:**
- Create: `lib/engine/forecast.ts`
- Modify: `lib/engine/types.ts` (re-export ForecastInput/ForecastResult), `lib/engine/index.ts` (add export)
- Test: `lib/engine/forecast.test.ts`

**Interfaces:**
- Consumes: `generateInstances` from `./instances`; types from `./types`.
- Produces:
  - `computeForecast(input: ForecastInput): ForecastResult`
  - `ForecastInput { anchorBalance:number; anchorDate:Date; viewStart:Date; viewEnd:Date; today:Date; skipToday:boolean; particulars:EngineParticular[]; holidays:EngineHoliday[] }`
  - `ForecastResult { days:DailyBalance[]; months:MonthlySummary[]; firstNegative:DailyBalance|null; lowest:DailyBalance|null }`
  - Replays day-by-day from `min(anchorDate, viewStart)` through `viewEnd`, seeded with `anchorBalance`; returns only days within `[viewStart, viewEnd]`. `skipToday` drops events whose day equals `today`.

- [ ] **Step 1: Write the failing tests**

`lib/engine/forecast.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeForecast } from "./forecast";
import type { EngineParticular, ForecastInput } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");

const expense = (id: string, day: string, amt: number): EngineParticular => ({
  id, name: id, type: "EXPENSE", amount: amt, frequency: "ONCE_OFF",
  startDate: d(day), endDate: null, isCritical: true, isFixed: true,
  businessDayAdjustment: "NONE", overrides: [],
});

const baseInput = (over: Partial<ForecastInput>): ForecastInput => ({
  anchorBalance: 1000, anchorDate: d("2026-07-01"),
  viewStart: d("2026-07-01"), viewEnd: d("2026-07-05"),
  today: d("2026-07-01"), skipToday: false,
  particulars: [], holidays: [], ...over,
});

describe("computeForecast", () => {
  it("seeds the first opening balance with anchorBalance", () => {
    const r = computeForecast(baseInput({}));
    expect(r.days[0]!.openingBalance).toBe(1000);
  });

  it("applies an expense to the closing balance", () => {
    const r = computeForecast(baseInput({ particulars: [expense("rent", "2026-07-02", 200)] }));
    const jul2 = r.days.find(x => x.date.getDate() === 2)!;
    expect(jul2.closingBalance).toBe(800);
  });

  it("anchors future-window balances to events BEFORE viewStart", () => {
    // anchorDate Jul 1, but we only DISPLAY Jul 4-5; an expense on Jul 2 must still count
    const r = computeForecast(baseInput({
      viewStart: d("2026-07-04"), viewEnd: d("2026-07-05"),
      particulars: [expense("rent", "2026-07-02", 200)],
    }));
    expect(r.days[0]!.date.getDate()).toBe(4);      // display starts Jul 4
    expect(r.days[0]!.openingBalance).toBe(800);     // but reflects the Jul 2 expense
  });

  it("flags a negative day and reports firstNegative", () => {
    const r = computeForecast(baseInput({ particulars: [expense("big", "2026-07-02", 5000)] }));
    expect(r.firstNegative).not.toBeNull();
    expect(r.firstNegative!.date.getDate()).toBe(2);
  });

  it("reports the lowest balance day", () => {
    const r = computeForecast(baseInput({
      particulars: [expense("a", "2026-07-02", 300), expense("b", "2026-07-03", 100)],
    }));
    expect(r.lowest!.date.getDate()).toBe(3);
    expect(r.lowest!.closingBalance).toBe(600);
  });

  it("skipToday drops today's events", () => {
    const r = computeForecast(baseInput({
      today: d("2026-07-02"), skipToday: true,
      particulars: [expense("rent", "2026-07-02", 200)],
    }));
    const jul2 = r.days.find(x => x.date.getDate() === 2)!;
    expect(jul2.events).toHaveLength(0);
    expect(jul2.closingBalance).toBe(1000);
  });

  it("produces a monthly summary with net change", () => {
    const r = computeForecast(baseInput({
      viewStart: d("2026-07-01"), viewEnd: d("2026-07-31"),
      particulars: [expense("rent", "2026-07-02", 200)],
    }));
    expect(r.months).toHaveLength(1);
    expect(r.months[0]!.totalExpenses).toBe(-200);
    expect(r.months[0]!.netChange).toBe(-200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run lib/engine/forecast.test.ts`
Expected: FAIL — cannot find module `./forecast`.

- [ ] **Step 3: Implement the forecast replay**

`lib/engine/forecast.ts`:
```ts
import { startOfDay, compareAsc, addDays } from "date-fns";
import { generateInstances } from "./instances";
import type {
  EngineParticular, EngineHoliday, DailyBalance, DailyEvent, MonthlySummary,
} from "./types";

export interface ForecastInput {
  anchorBalance: number;
  anchorDate: Date;
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
}

export function computeForecast(input: ForecastInput): ForecastResult {
  const { anchorBalance, anchorDate, viewStart, viewEnd, today, skipToday, particulars, holidays } = input;

  const replayStart = startOfDay(anchorDate < viewStart ? anchorDate : viewStart);
  const displayStart = startOfDay(viewStart);
  const end = startOfDay(viewEnd);
  const todayKey = startOfDay(today).getTime();

  // Generate every instance across the replay window, grouped by day.
  const byDay = new Map<number, { name: string; particularId: string; amount: number;
    isOverridden: boolean; isSkipped: boolean; isMovedDueToHoliday: boolean; originalDate?: Date }[]>();

  for (const p of particulars) {
    const instances = generateInstances(p, replayStart, end, holidays);
    for (const inst of instances) {
      const key = startOfDay(inst.date).getTime();
      const list = byDay.get(key) ?? [];
      list.push({
        name: p.name, particularId: p.id, amount: inst.amount,
        isOverridden: inst.isOverridden, isSkipped: inst.isSkipped,
        isMovedDueToHoliday: inst.isMovedDueToHoliday, originalDate: inst.originalDate,
      });
      byDay.set(key, list);
    }
  }

  const days: DailyBalance[] = [];
  let running = anchorBalance;
  let cursor = replayStart;

  while (cursor <= end) {
    const key = cursor.getTime();
    const opening = running;
    const events: DailyEvent[] = [];

    for (const raw of byDay.get(key) ?? []) {
      if (raw.isSkipped) continue;
      if (skipToday && key === todayKey) continue;
      events.push({
        particularId: raw.particularId,
        name: raw.name,
        amount: raw.amount,
        kind: raw.amount >= 0 ? "income" : "expense",
        isOverridden: raw.isOverridden,
        isSkipped: raw.isSkipped,
        isMovedDueToHoliday: raw.isMovedDueToHoliday,
        originalDate: raw.originalDate,
      });
      running += raw.amount;
    }

    if (cursor >= displayStart) {
      days.push({
        date: new Date(cursor),
        openingBalance: opening,
        closingBalance: running,
        events,
        isNegative: running < 0,
      });
    }
    cursor = startOfDay(addDays(cursor, 1));
  }

  return {
    days,
    months: summarize(days),
    firstNegative: days.find((day) => day.isNegative) ?? null,
    lowest: days.length
      ? days.reduce((lo, c) => (c.closingBalance < lo.closingBalance ? c : lo))
      : null,
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
        daysWithNegativeBalance: 0,
      };
      map.set(k, s);
    }
    for (const e of day.events) {
      if (e.amount > 0) s.totalIncome += e.amount;
      else s.totalExpenses += e.amount;
    }
    s.closingBalance = day.closingBalance;
    if (day.isNegative) s.daysWithNegativeBalance++;
  }
  for (const s of map.values()) s.netChange = s.totalIncome + s.totalExpenses;
  return [...map.values()].sort((a, b) => compareAsc(a.month, b.month));
}
```

Append to `lib/engine/types.ts` so tests can import the input type from `./types`:
```ts
export type { ForecastInput, ForecastResult } from "./forecast";
```

`lib/engine/index.ts` (append):
```ts
export * from "./forecast";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/engine/forecast.test.ts`
Expected: PASS (all 7 cases). Then run the full suite: `npm test -- run` → all engine tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/engine
git commit -m "feat(engine): anchored forecast replay with monthly/lowest/first-negative"
```

---

### Task 6: Shared Zod schemas

**Files:**
- Create: `lib/schemas/particular.ts`
- Create: `lib/schemas/holiday.ts`
- Create: `lib/schemas/account.ts`
- Create: `lib/schemas/index.ts`
- Test: `lib/schemas/particular.test.ts`

**Interfaces:**
- Produces (all importable without Prisma/React; `zod` already in deps from Task 1):
  - `particularInput` Zod schema → `{ name, type:'INCOME'|'EXPENSE', amount>0, frequency, startDate, endDate?, isCritical, isFixed, businessDayAdjustment }`
  - `overrideInstanceInput` → `{ particularId, originalDate, overriddenAmount?, overriddenDate?, isSkipped }`
  - `holidayInput` → `{ name, date, isRecurring }`
  - `updateBalanceInput` → `{ balance }`

- [ ] **Step 1: Write the failing test**

`lib/schemas/particular.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { particularInput } from "./particular";

describe("particularInput", () => {
  it("rejects a non-positive amount", () => {
    const r = particularInput.safeParse({
      name: "Rent", type: "EXPENSE", amount: 0, frequency: "MONTHLY",
      startDate: new Date(), isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    });
    expect(r.success).toBe(false);
  });
  it("accepts a valid particular", () => {
    const r = particularInput.safeParse({
      name: "Rent", type: "EXPENSE", amount: 1500, frequency: "MONTHLY",
      startDate: new Date(), isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run lib/schemas/particular.test.ts`
Expected: FAIL — cannot find module `./particular`.

- [ ] **Step 3: Implement the schemas**

`lib/schemas/particular.ts`:
```ts
import { z } from "zod";

export const particularType = z.enum(["INCOME", "EXPENSE"]);
export const frequency = z.enum(["ONCE_OFF", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "ANNUAL"]);
export const bdaAdjustment = z.enum(["NONE", "NEXT_BUSINESS_DAY", "PREVIOUS_BUSINESS_DAY"]);

export const particularInput = z.object({
  name: z.string().min(1).max(200),
  type: particularType,
  amount: z.number().positive("Amount must be positive"),
  frequency,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  isCritical: z.boolean().default(true),
  isFixed: z.boolean().default(true),
  businessDayAdjustment: bdaAdjustment.default("NONE"),
}).refine((v) => !v.endDate || v.endDate >= v.startDate, {
  message: "End date must be on or after start date", path: ["endDate"],
});

export const overrideInstanceInput = z.object({
  particularId: z.string(),
  originalDate: z.coerce.date(),
  overriddenAmount: z.number().optional(),
  overriddenDate: z.coerce.date().optional(),
  isSkipped: z.boolean().default(false),
});

export type ParticularInput = z.infer<typeof particularInput>;
export type OverrideInstanceInput = z.infer<typeof overrideInstanceInput>;
```

`lib/schemas/holiday.ts`:
```ts
import { z } from "zod";
export const holidayInput = z.object({
  name: z.string().min(1).max(200),
  date: z.coerce.date(),
  isRecurring: z.boolean().default(false),
});
export type HolidayInput = z.infer<typeof holidayInput>;
```

`lib/schemas/account.ts`:
```ts
import { z } from "zod";
export const updateBalanceInput = z.object({ balance: z.number() });
export type UpdateBalanceInput = z.infer<typeof updateBalanceInput>;
```

`lib/schemas/index.ts`:
```ts
export * from "./particular";
export * from "./holiday";
export * from "./account";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/schemas/particular.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas
git commit -m "feat(schemas): shared zod input schemas"
```

---

## Phase 2 — Server (Prisma, NextAuth, tRPC) on Next.js route handlers

> Server modules live in `server/` and are server-only. Tests use Vitest with a mocked Prisma client (no live DB needed for router unit tests); the mapper test is pure.

### Task 7: Prisma schema + client singleton

**Files:**
- Create: `prisma/schema.prisma`
- Create: `server/db.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: `prisma` client singleton exported from `server/db.ts`; generated types for `Particular`, `ParticularOverride`, `Holiday`, `FinanceAccount`, plus Auth.js tables.

- [ ] **Step 1: Write the Prisma schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String          @id @default(cuid())
  name          String?
  email         String?         @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  financeAccount FinanceAccount?
}

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
  @@unique([identifier, token])
}

model FinanceAccount {
  id               String   @id @default(cuid())
  name             String   @default("My Account")
  currentBalance   Decimal  @default(0) @db.Decimal(15, 2)
  balanceUpdatedAt DateTime @default(now())
  ownerId          String   @unique
  owner            User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  particulars      Particular[]
  holidays         Holiday[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model Particular {
  id                    String                @id @default(cuid())
  accountId             String
  name                  String
  type                  ParticularType
  amount                Decimal               @db.Decimal(15, 2)
  frequency             RecurrenceFrequency   @default(ONCE_OFF)
  startDate             DateTime              @db.Date
  endDate               DateTime?             @db.Date
  isCritical            Boolean               @default(true)
  isFixed               Boolean               @default(true)
  businessDayAdjustment BusinessDayAdjustment @default(NONE)
  createdAt             DateTime              @default(now())
  updatedAt             DateTime              @updatedAt
  account               FinanceAccount        @relation(fields: [accountId], references: [id], onDelete: Cascade)
  overrides             ParticularOverride[]
  @@index([accountId, startDate, endDate])
}

model ParticularOverride {
  id               String     @id @default(cuid())
  particularId     String
  originalDate     DateTime   @db.Date
  overriddenDate   DateTime?  @db.Date
  overriddenAmount Decimal?   @db.Decimal(15, 2)
  isSkipped        Boolean    @default(false)
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  particular       Particular @relation(fields: [particularId], references: [id], onDelete: Cascade)
  @@unique([particularId, originalDate])
}

model Holiday {
  id          String         @id @default(cuid())
  accountId   String
  name        String
  date        DateTime       @db.Date
  isRecurring Boolean        @default(false)
  account     FinanceAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  @@unique([accountId, date])
}

enum ParticularType        { INCOME EXPENSE }
enum RecurrenceFrequency   { ONCE_OFF WEEKLY FORTNIGHTLY MONTHLY ANNUAL }
enum BusinessDayAdjustment { NONE NEXT_BUSINESS_DAY PREVIOUS_BUSINESS_DAY }
```

- [ ] **Step 2: Create the env example**

`.env.example`:
```
DATABASE_URL="postgresql://postgres:password@localhost:5432/future_finance_v2"
AUTH_SECRET="generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"
```

- [ ] **Step 3: Implement the Prisma client singleton**

`server/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["error", "warn"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: Generate the client**

Run (from repo root): `npm run db:generate`
Expected: Prisma client generated without errors. (A live DB is not required to generate.)

- [ ] **Step 5: Commit**

```bash
git add prisma server/db.ts .env.example
git commit -m "feat(server): prisma schema and client singleton"
```

---

### Task 8: Prisma → Engine mappers

**Files:**
- Create: `server/mappers.ts`
- Test: `server/mappers.test.ts`

**Interfaces:**
- Consumes: Prisma row shapes for `Particular` (with `overrides`) and `Holiday`; `EngineParticular`, `EngineHoliday`, `EngineOverride` from `@/lib/engine`.
- Produces:
  - `toEngineParticular(p: PrismaParticularWithOverrides): EngineParticular`
  - `toEngineHoliday(h: { date: Date; isRecurring: boolean }): EngineHoliday`
  - Converts `Decimal` (and stored sign) to a positive `number` amount; the engine applies the sign.

- [ ] **Step 1: Write the failing test**

`server/mappers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toEngineParticular } from "./mappers";

const decimal = (n: number) => ({ toString: () => String(n) }) as unknown as { toString(): string };

describe("toEngineParticular", () => {
  it("maps Decimal amount to a positive number", () => {
    const e = toEngineParticular({
      id: "p1", name: "Rent", type: "EXPENSE", amount: decimal(1500),
      frequency: "MONTHLY", startDate: new Date("2026-07-01"), endDate: null,
      isCritical: true, isFixed: true, businessDayAdjustment: "NONE", overrides: [],
    } as never);
    expect(e.amount).toBe(1500);
    expect(e.type).toBe("EXPENSE");
  });

  it("maps override Decimal amounts and null dates", () => {
    const e = toEngineParticular({
      id: "p1", name: "Rent", type: "EXPENSE", amount: decimal(1500),
      frequency: "MONTHLY", startDate: new Date("2026-07-01"), endDate: null,
      isCritical: false, isFixed: false, businessDayAdjustment: "NONE",
      overrides: [{ id: "o1", originalDate: new Date("2026-08-01"),
        overriddenDate: null, overriddenAmount: decimal(1600), isSkipped: false }],
    } as never);
    expect(e.overrides[0]!.overriddenAmount).toBe(1600);
    expect(e.overrides[0]!.overriddenDate).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run server/mappers.test.ts`
Expected: FAIL — cannot find module `./mappers`.

- [ ] **Step 3: Implement the mappers**

`server/mappers.ts`:
```ts
import type { EngineParticular, EngineHoliday, EngineOverride } from "@/lib/engine";

type DecimalLike = { toString(): string } | number;
const num = (d: DecimalLike): number => (typeof d === "number" ? d : Number(d.toString()));

interface PrismaOverride {
  id: string; originalDate: Date;
  overriddenDate: Date | null; overriddenAmount: DecimalLike | null; isSkipped: boolean;
}
interface PrismaParticular {
  id: string; name: string; type: "INCOME" | "EXPENSE"; amount: DecimalLike;
  frequency: EngineParticular["frequency"]; startDate: Date; endDate: Date | null;
  isCritical: boolean; isFixed: boolean;
  businessDayAdjustment: EngineParticular["businessDayAdjustment"];
  overrides: PrismaOverride[];
}

function toEngineOverride(o: PrismaOverride): EngineOverride {
  return {
    id: o.id, originalDate: o.originalDate, overriddenDate: o.overriddenDate,
    overriddenAmount: o.overriddenAmount === null ? null : Math.abs(num(o.overriddenAmount)),
    isSkipped: o.isSkipped,
  };
}

export function toEngineParticular(p: PrismaParticular): EngineParticular {
  return {
    id: p.id, name: p.name, type: p.type,
    amount: Math.abs(num(p.amount)),
    frequency: p.frequency, startDate: p.startDate, endDate: p.endDate,
    isCritical: p.isCritical, isFixed: p.isFixed,
    businessDayAdjustment: p.businessDayAdjustment,
    overrides: p.overrides.map(toEngineOverride),
  };
}

export function toEngineHoliday(h: { date: Date; isRecurring: boolean }): EngineHoliday {
  return { date: h.date, isRecurring: h.isRecurring };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run server/mappers.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add server/mappers.ts server/mappers.test.ts
git commit -m "feat(server): prisma-to-engine mappers"
```

---

### Task 9: NextAuth v5 config + tRPC init (context, protectedProcedure, resolveAccount)

**Files:**
- Create: `server/auth.ts`
- Create: `server/trpc.ts`
- Test: `server/trpc.test.ts`

**Interfaces:**
- Consumes: `prisma` from `./db`.
- Produces:
  - From `auth.ts`: `handlers` (`{ GET, POST }`), `auth`, `signIn`, `signOut` from `NextAuth(...)`, configured with the Prisma adapter and a database session strategy.
  - From `trpc.ts`: `createContext()` (reads the session via `auth()`), `router`, `publicProcedure`, `protectedProcedure` (throws `UNAUTHORIZED` when no user), and `resolveAccount(userId): Promise<FinanceAccount>` — finds the user's single account, auto-creating it if missing.

- [ ] **Step 1: Write the failing test**

`server/trpc.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./db", () => ({
  prisma: {
    financeAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "acc1", ownerId: "u1", currentBalance: 0 }),
    },
  },
}));
// auth.ts pulls in next-auth (ESM-only at import time); stub it for the unit test.
vi.mock("./auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { resolveAccount } from "./trpc";

describe("resolveAccount", () => {
  it("auto-creates an account when the user has none", async () => {
    const acc = await resolveAccount("u1");
    expect(acc.id).toBe("acc1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run server/trpc.test.ts`
Expected: FAIL — cannot find module `./trpc`.

- [ ] **Step 3: Implement auth + trpc**

`server/auth.ts`:
```ts
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./db";

// Provider list intentionally minimal for the first slice; add OAuth/email providers here.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [],
  secret: process.env.AUTH_SECRET,
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
});
```

`server/trpc.ts`:
```ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { prisma } from "./db";
import { auth } from "./auth";

export async function createContext() {
  const session = await auth();
  const id = session?.user?.id;
  return { user: id ? { id } : null, prisma };
}
export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export async function resolveAccount(userId: string) {
  const existing = await prisma.financeAccount.findUnique({ where: { ownerId: userId } });
  if (existing) return existing;
  return prisma.financeAccount.create({
    data: { ownerId: userId, name: "My Account", currentBalance: 0 },
  });
}
```

Also create the NextAuth type augmentation so `session.user.id` typechecks.

`types/next-auth.d.ts`:
```ts
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run server/trpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth.ts server/trpc.ts server/trpc.test.ts types/next-auth.d.ts
git commit -m "feat(server): nextauth v5 config, trpc init, resolveAccount"
```

---

### Task 10: tRPC routers (account, holiday, particular, forecast) + appRouter

**Files:**
- Create: `server/routers/account.ts`
- Create: `server/routers/holiday.ts`
- Create: `server/routers/particular.ts`
- Create: `server/routers/forecast.ts`
- Create: `server/routers/_app.ts`
- Test: `server/routers/particular.test.ts`

**Interfaces:**
- Consumes: `router`, `protectedProcedure`, `resolveAccount` from `../trpc`; schemas from `@/lib/schemas`.
- Produces: `appRouter` and `export type AppRouter = typeof appRouter` from `_app.ts`. Procedures listed in the spec's API surface. `assertOverrideAllowed(rule, ov)` enforces: amount override rejected if `isFixed`; date/skip rejected if `isCritical`.

- [ ] **Step 1: Write the failing test (override validation)**

`server/routers/particular.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { assertOverrideAllowed } from "./particular";

describe("assertOverrideAllowed", () => {
  it("rejects amount override on a fixed particular", () => {
    expect(() => assertOverrideAllowed(
      { isFixed: true, isCritical: false },
      { overriddenAmount: 50, overriddenDate: undefined, isSkipped: false },
    )).toThrow(/fixed/i);
  });
  it("rejects skip on a critical particular", () => {
    expect(() => assertOverrideAllowed(
      { isFixed: false, isCritical: true },
      { overriddenAmount: undefined, overriddenDate: undefined, isSkipped: true },
    )).toThrow(/critical/i);
  });
  it("allows a valid amount override on an adjustable particular", () => {
    expect(() => assertOverrideAllowed(
      { isFixed: false, isCritical: true },
      { overriddenAmount: 50, overriddenDate: undefined, isSkipped: false },
    )).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run server/routers/particular.test.ts`
Expected: FAIL — cannot find module `./particular`.

- [ ] **Step 3: Implement the routers**

`server/routers/account.ts`:
```ts
import { router, protectedProcedure, resolveAccount } from "../trpc";
import { updateBalanceInput } from "@/lib/schemas";

export const accountRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const a = await resolveAccount(ctx.user.id);
    return { id: a.id, name: a.name, currentBalance: Number(a.currentBalance), balanceUpdatedAt: a.balanceUpdatedAt };
  }),
  updateBalance: protectedProcedure.input(updateBalanceInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.financeAccount.update({
      where: { id: a.id },
      data: { currentBalance: input.balance, balanceUpdatedAt: new Date() },
    });
  }),
});
```

`server/routers/holiday.ts`:
```ts
import { z } from "zod";
import { router, protectedProcedure, resolveAccount } from "../trpc";
import { holidayInput } from "@/lib/schemas";

export const holidayRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.holiday.findMany({ where: { accountId: a.id }, orderBy: { date: "asc" } });
  }),
  create: protectedProcedure.input(holidayInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.holiday.create({ data: { ...input, accountId: a.id } });
  }),
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.holiday.deleteMany({ where: { id: input.id, accountId: a.id } });
  }),
});
```

`server/routers/particular.ts`:
```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, resolveAccount } from "../trpc";
import { particularInput, overrideInstanceInput } from "@/lib/schemas";

export function assertOverrideAllowed(
  rule: { isFixed: boolean; isCritical: boolean },
  ov: { overriddenAmount?: number; overriddenDate?: Date; isSkipped: boolean },
) {
  if (ov.overriddenAmount !== undefined && rule.isFixed)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot override amount for a fixed particular" });
  if ((ov.overriddenDate !== undefined || ov.isSkipped) && rule.isCritical)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot override date or skip a critical particular" });
}

export const particularRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.particular.findMany({
      where: { accountId: a.id }, include: { overrides: true }, orderBy: { startDate: "asc" },
    });
  }),
  create: protectedProcedure.input(particularInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.particular.create({ data: { ...input, accountId: a.id } });
  }),
  update: protectedProcedure.input(particularInput.and(z.object({ id: z.string() })))
    .mutation(async ({ ctx, input }) => {
      const a = await resolveAccount(ctx.user.id);
      const { id, ...data } = input;
      const owned = await ctx.prisma.particular.findFirst({ where: { id, accountId: a.id } });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.particular.update({ where: { id }, data });
    }),
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.particular.deleteMany({ where: { id: input.id, accountId: a.id } });
  }),
  overrideInstance: protectedProcedure.input(overrideInstanceInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    const p = await ctx.prisma.particular.findFirst({ where: { id: input.particularId, accountId: a.id } });
    if (!p) throw new TRPCError({ code: "NOT_FOUND" });
    assertOverrideAllowed({ isFixed: p.isFixed, isCritical: p.isCritical }, input);
    return ctx.prisma.particularOverride.upsert({
      where: { particularId_originalDate: { particularId: input.particularId, originalDate: input.originalDate } },
      create: {
        particularId: input.particularId, originalDate: input.originalDate,
        overriddenAmount: input.overriddenAmount ?? null,
        overriddenDate: input.overriddenDate ?? null, isSkipped: input.isSkipped,
      },
      update: {
        overriddenAmount: input.overriddenAmount ?? null,
        overriddenDate: input.overriddenDate ?? null, isSkipped: input.isSkipped,
      },
    });
  }),
  deleteOverride: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    const ov = await ctx.prisma.particularOverride.findFirst({
      where: { id: input.id, particular: { accountId: a.id } },
    });
    if (!ov) throw new TRPCError({ code: "NOT_FOUND" });
    return ctx.prisma.particularOverride.delete({ where: { id: input.id } });
  }),
  listOverrides: protectedProcedure.input(z.object({ particularId: z.string() })).query(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.particularOverride.findMany({
      where: { particularId: input.particularId, particular: { accountId: a.id } },
      orderBy: { originalDate: "asc" },
    });
  }),
});
```

`server/routers/forecast.ts`:
```ts
import { z } from "zod";
import { router, protectedProcedure, resolveAccount } from "../trpc";

export const forecastRouter = router({
  // Returns raw data for the FULL replay window [balanceUpdatedAt .. viewEnd].
  getData: protectedProcedure
    .input(z.object({ viewStart: z.coerce.date(), viewEnd: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const a = await resolveAccount(ctx.user.id);
      const windowStart = a.balanceUpdatedAt < input.viewStart ? a.balanceUpdatedAt : input.viewStart;

      const particulars = await ctx.prisma.particular.findMany({
        where: {
          accountId: a.id,
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
          accountId: a.id,
          OR: [
            { isRecurring: false, date: { gte: windowStart, lte: input.viewEnd } },
            { isRecurring: true },
          ],
        },
        orderBy: { date: "asc" },
      });

      return {
        account: { currentBalance: Number(a.currentBalance), balanceUpdatedAt: a.balanceUpdatedAt },
        particulars, holidays,
      };
    }),
});
```

`server/routers/_app.ts`:
```ts
import { router } from "../trpc";
import { accountRouter } from "./account";
import { holidayRouter } from "./holiday";
import { particularRouter } from "./particular";
import { forecastRouter } from "./forecast";

export const appRouter = router({
  account: accountRouter,
  holiday: holidayRouter,
  particular: particularRouter,
  forecast: forecastRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run server/routers/particular.test.ts`
Expected: PASS (all 3 cases). Then `npm test -- run` → all engine + server tests green.

- [ ] **Step 5: Commit**

```bash
git add server/routers
git commit -m "feat(server): account/holiday/particular/forecast routers"
```

---

### Task 11: Route handlers (tRPC + NextAuth) on App Router

**Files:**
- Create: `app/api/trpc/[trpc]/route.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Create: `next.config.ts`
- Create: `next-env.d.ts` (generated; commit it)

**Interfaces:**
- Consumes: `appRouter` from `@/server/routers/_app`; `createContext` from `@/server/trpc`; `handlers` from `@/server/auth`.
- Produces: live `/api/trpc/*` (tRPC fetch adapter) and `/api/auth/*` (NextAuth) endpoints. No new unit test (covered by the full-stack smoke in Task 17).

- [ ] **Step 1: Implement the tRPC fetch route handler**

`app/api/trpc/[trpc]/route.ts`:
```ts
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/routers/_app";
import { createContext } from "@/server/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
```

- [ ] **Step 2: Implement the NextAuth route handler**

`app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from "@/server/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 3: Add Next config**

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Verify it builds / generates next-env**

Run (from repo root): `npx next build`
Expected: build completes (it may warn that no pages render yet, but the route handlers compile). This also generates `next-env.d.ts`.

> If `next build` requires a `DATABASE_URL` at build time, copy `.env.example` → `.env` with any valid-looking Postgres URL first; the routes don't connect at build time.

- [ ] **Step 5: Commit**

```bash
git add app/api next.config.ts next-env.d.ts
git commit -m "feat(app): trpc and nextauth route handlers"
```

---

## Phase 3 — Client (theme port, providers, screens)

> Client tasks port the `baseline/` theme + components into `app/`. These are already Next.js-native shadcn components, so they drop in with only import-path adjustments. Components using tRPC hooks or browser state are Client Components (`"use client"`).

### Task 12: Tailwind + theme port + design-system/utils helpers

**Files:**
- Create: `app/globals.css` (ported from `baseline/globals.css`)
- Create: `postcss.config.mjs`
- Create: `lib/utils.ts` (ported from `baseline/utils.ts` — `cn`)
- Create: `lib/design-system.ts` (consolidated helpers only)
- Test: `lib/design-system.test.ts`

**Interfaces:**
- Produces:
  - `cn(...inputs: ClassValue[]): string` from `lib/utils.ts`
  - `formatCurrency(amount: number): string` (NZD), `getAmountColorClass`, `getAmountBgClass`, `isStale`, `getRelativeTime`, `MIN_TOUCH_TARGET` from `lib/design-system.ts`

- [ ] **Step 1: Write the failing test**

`lib/design-system.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatCurrency, getAmountColorClass } from "./design-system";

describe("formatCurrency", () => {
  it("formats NZD with two decimals", () => {
    expect(formatCurrency(1500)).toBe("$1,500.00");
  });
});

describe("getAmountColorClass", () => {
  it("returns income class for positive amounts", () => {
    expect(getAmountColorClass(10)).toBe("text-finance-income");
  });
  it("returns expense class for negative amounts", () => {
    expect(getAmountColorClass(-10)).toBe("text-finance-expense");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run lib/design-system.test.ts`
Expected: FAIL — cannot find module `./design-system`.

- [ ] **Step 3: Port the theme + implement helpers**

Copy the baseline CSS verbatim:
Run (from repo root): `cp baseline/globals.css app/globals.css`

`postcss.config.mjs`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

Copy `cn` from the baseline so the shadcn primitives import it unchanged:
Run (from repo root): `cp baseline/utils.ts lib/utils.ts`

> If `baseline/utils.ts` imports anything beyond `clsx`/`tailwind-merge`, trim it to just `cn`. The canonical body is:
> ```ts
> import { clsx, type ClassValue } from "clsx";
> import { twMerge } from "tailwind-merge";
> export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
> ```

`lib/design-system.ts`:
```ts
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency", currency: "NZD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(amount);
}
export function getAmountColorClass(amount: number): string {
  if (amount > 0) return "text-finance-income";
  if (amount < 0) return "text-finance-expense";
  return "text-muted-foreground";
}
export function getAmountBgClass(amount: number): string {
  if (amount > 0) return "bg-finance-income";
  if (amount < 0) return "bg-finance-expense";
  return "bg-muted";
}
export function isStale(date: Date, maxDays = 3): boolean {
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  return diffDays > maxDays;
}
export function getRelativeTime(date: Date): string {
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
export const MIN_TOUCH_TARGET = "44px";
```

> Note: `getAmountColorClass`/`getAmountBgClass`/`text-finance-*` rely on the finance-semantic tokens defined in the ported `globals.css`. The formatCurrency test asserts the `en-NZ` `$` symbol with grouping; if the local ICU differs, normalize the expected string accordingly — the symbol/format come from `Intl`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/design-system.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css postcss.config.mjs lib/utils.ts lib/design-system.ts lib/design-system.test.ts
git commit -m "feat(client): tailwind theme port and design-system helpers"
```

---

### Task 13: Root layout + providers (tRPC client, React Query, theme)

**Files:**
- Create: `trpc/client.ts`
- Create: `app/providers.tsx`
- Create: `app/layout.tsx`
- Create: `app/page.tsx` (temporary placeholder; replaced in Task 16)

**Interfaces:**
- Consumes: `AppRouter` type from `@/server/routers/_app`.
- Produces:
  - `trpc` React client (`createTRPCReact<AppRouter>()`) from `trpc/client.ts`
  - `Providers` Client Component wrapping children with the tRPC provider, a `QueryClientProvider`, and `next-themes` `ThemeProvider`
  - A root layout importing `globals.css` and rendering `<Providers>`

- [ ] **Step 1: Create the tRPC React client**

`trpc/client.ts`:
```ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/routers/_app";
export const trpc = createTRPCReact<AppRouter>();
```

- [ ] **Step 2: Implement the providers (Client Component)**

`app/providers.tsx`:
```tsx
"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { ThemeProvider } from "next-themes";
import { trpc } from "@/trpc/client";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
```

- [ ] **Step 3: Implement the root layout + placeholder page**

`app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = { title: "Future Finance" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

`app/page.tsx` (placeholder — replaced in Task 16):
```tsx
export default function Page() {
  return <div className="p-6">Future Finance v2</div>;
}
```

- [ ] **Step 4: Verify the dev server boots**

> Per local convention, dev may already be running on port 3000 (`dev.log`). If not, run `npm run dev` in a scratch terminal.
Open `http://localhost:3000`: page shows "Future Finance v2" on the themed background. (Stop any dev server you started.)

- [ ] **Step 5: Commit**

```bash
git add trpc/client.ts app/providers.tsx app/layout.tsx app/page.tsx
git commit -m "feat(client): root layout, trpc/react-query/theme providers"
```

---

### Task 14: Port shared UI primitives + theme toggle + app shell

**Files:**
- Create: `app/_components/ui/*` (ported from `baseline/components/ui/*`)
- Create: `components.json` (ported from baseline if present; else generated)
- Create: `app/_components/theme-toggle.tsx`
- Create: `app/_components/Layout.tsx`, `Sidebar.tsx`, `BottomNav.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`; theme tokens from `app/globals.css`; `useTheme` from `next-themes`.
- Produces: themed `ui/*` primitives (button, card, dialog, input, select, checkbox, badge, dropdown-menu, label, radio-group, separator, textarea); `ThemeToggle`; `Layout` (sidebar ≥768px, bottom-nav on mobile) using `next/link` + `usePathname()`.

- [ ] **Step 1: Port shadcn UI primitives + config**

Run (from repo root):
```bash
mkdir -p app/_components/ui
cp baseline/components/ui/*.tsx app/_components/ui/
cp baseline/components.json components.json
```
These import `cn` from `@/lib/utils` (Task 12). If any ported file imports `cn` from a different path (e.g. `@/components/ui/...`), fix the import to `@/lib/utils`. No other code changes.

- [ ] **Step 2: Implement the theme toggle (Client Component)**

`app/_components/theme-toggle.tsx`:
```tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/app/_components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme">
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}
```

- [ ] **Step 3: Implement the app shell (Client Components)**

`app/_components/Sidebar.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListOrdered, CalendarDays } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/particulars", label: "Income & Expenses", icon: ListOrdered },
  { to: "/holidays", label: "Holidays", icon: CalendarDays },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between p-4">
        <span className="font-bold">Future Finance</span>
        <ThemeToggle />
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {items.map(({ to, label, icon: Icon }) => (
          <Link key={to} href={to}
            className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm",
              pathname === to ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50")}>
            <Icon className="h-4 w-4" />{label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

`app/_components/BottomNav.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListOrdered, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/particulars", label: "Items", icon: ListOrdered },
  { to: "/holidays", label: "Holidays", icon: CalendarDays },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t bg-background md:hidden">
      {items.map(({ to, label, icon: Icon }) => (
        <Link key={to} href={to}
          className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-xs",
            pathname === to ? "text-foreground" : "text-muted-foreground")}>
          <Icon className="h-5 w-5" />{label}
        </Link>
      ))}
    </nav>
  );
}
```

`app/_components/Layout.tsx`:
```tsx
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 pb-20 md:p-6 md:pb-6">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
```

- [ ] **Step 4: Verify it builds**

Run (from repo root): `npx next build`
Expected: build succeeds (shell components compile; primitives resolve `cn` and tokens).

- [ ] **Step 5: Commit**

```bash
git add app/_components components.json
git commit -m "feat(client): port ui primitives, theme toggle, app shell"
```

---

### Task 15: ActiveAccountProvider + Particulars & Holidays & Login pages

**Files:**
- Create: `app/_providers/ActiveAccountProvider.tsx`
- Create: `app/particulars/page.tsx`, `app/particulars/ParticularForm.tsx`, `app/particulars/OverrideManagement.tsx`
- Create: `app/holidays/page.tsx`
- Create: `app/login/page.tsx`

**Interfaces:**
- Consumes: `trpc` hooks from `@/trpc/client`; `particularInput`/`holidayInput` from `@/lib/schemas`; `Layout` from `@/app/_components/Layout`; `formatCurrency` from `@/lib/design-system`; ported `ui/*`.
- Produces: working `/particulars` (list + create/edit/delete + override management), `/holidays` (list + create/delete), `/login`; an `ActiveAccountProvider` exposing the single account via `trpc.account.get`.

- [ ] **Step 1: Implement ActiveAccountProvider (Client Component)**

`app/_providers/ActiveAccountProvider.tsx`:
```tsx
"use client";

import { createContext, useContext } from "react";
import { trpc } from "@/trpc/client";

type Account = { id: string; name: string; currentBalance: number; balanceUpdatedAt: Date };
const Ctx = createContext<{ account: Account | null; isLoading: boolean }>({ account: null, isLoading: true });

export function ActiveAccountProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = trpc.account.get.useQuery();
  return <Ctx.Provider value={{ account: data ?? null, isLoading }}>{children}</Ctx.Provider>;
}
export const useActiveAccount = () => useContext(Ctx);
```

- [ ] **Step 2: Implement the Particulars page + form + override management**

`app/particulars/ParticularForm.tsx` (Client Component — create/edit):
```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { particularInput, type ParticularInput } from "@/lib/schemas";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/app/_components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/app/_components/ui/select";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { Label } from "@/app/_components/ui/label";

export function ParticularForm(
  { isOpen, particularId, onClose }: { isOpen: boolean; particularId: string | null; onClose: () => void },
) {
  const utils = trpc.useUtils();
  const { data: existing } = trpc.particular.list.useQuery(undefined, {
    select: (rows) => rows.find((r) => r.id === particularId) ?? null,
    enabled: !!particularId,
  });

  const form = useForm<ParticularInput>({
    resolver: zodResolver(particularInput),
    defaultValues: {
      name: existing?.name ?? "",
      type: (existing?.type as "INCOME" | "EXPENSE") ?? "EXPENSE",
      amount: existing ? Math.abs(Number(existing.amount)) : 0,
      frequency: (existing?.frequency as ParticularInput["frequency"]) ?? "MONTHLY",
      startDate: existing ? new Date(existing.startDate) : new Date(),
      isCritical: existing?.isCritical ?? true,
      isFixed: existing?.isFixed ?? true,
      businessDayAdjustment: (existing?.businessDayAdjustment as ParticularInput["businessDayAdjustment"]) ?? "NONE",
    },
    values: existing
      ? {
          name: existing.name,
          type: existing.type as "INCOME" | "EXPENSE",
          amount: Math.abs(Number(existing.amount)),
          frequency: existing.frequency as ParticularInput["frequency"],
          startDate: new Date(existing.startDate),
          endDate: existing.endDate ? new Date(existing.endDate) : undefined,
          isCritical: existing.isCritical,
          isFixed: existing.isFixed,
          businessDayAdjustment: existing.businessDayAdjustment as ParticularInput["businessDayAdjustment"],
        }
      : undefined,
  });

  const onDone = () => { utils.particular.list.invalidate(); utils.forecast.getData.invalidate(); onClose(); };
  const create = trpc.particular.create.useMutation({ onSuccess: onDone });
  const update = trpc.particular.update.useMutation({ onSuccess: onDone });

  const submit = form.handleSubmit((values) => {
    if (particularId) update.mutate({ ...values, id: particularId });
    else create.mutate(values);
  });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{particularId ? "Edit" : "Add"} item</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1">
            <Label>Name</Label>
            <Input {...form.register("name")} />
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={form.watch("type")} onValueChange={(v) => form.setValue("type", v as "INCOME" | "EXPENSE")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INCOME">Income</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Amount</Label>
            <Input type="number" step="0.01" {...form.register("amount", { valueAsNumber: true })} />
          </div>
          <div className="space-y-1">
            <Label>Frequency</Label>
            <Select value={form.watch("frequency")} onValueChange={(v) => form.setValue("frequency", v as ParticularInput["frequency"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ONCE_OFF">Once-off</SelectItem>
                <SelectItem value="WEEKLY">Weekly</SelectItem>
                <SelectItem value="FORTNIGHTLY">Fortnightly</SelectItem>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="ANNUAL">Annual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Start date</Label>
            <Input type="date" {...form.register("startDate", { valueAsDate: true })} />
          </div>
          <div className="space-y-1">
            <Label>End date (optional)</Label>
            <Input type="date" {...form.register("endDate", { valueAsDate: true })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.watch("isCritical")} onCheckedChange={(c) => form.setValue("isCritical", !!c)} />
            Critical (cannot be skipped or moved)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.watch("isFixed")} onCheckedChange={(c) => form.setValue("isFixed", !!c)} />
            Fixed (amount cannot be overridden)
          </label>
          <div className="space-y-1">
            <Label>Business-day adjustment</Label>
            <Select value={form.watch("businessDayAdjustment")} onValueChange={(v) => form.setValue("businessDayAdjustment", v as ParticularInput["businessDayAdjustment"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None</SelectItem>
                <SelectItem value="NEXT_BUSINESS_DAY">Next business day</SelectItem>
                <SelectItem value="PREVIOUS_BUSINESS_DAY">Previous business day</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`app/particulars/OverrideManagement.tsx` (Client Component):
```tsx
"use client";

import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";

export function OverrideManagement({ particularId }: { particularId: string }) {
  const utils = trpc.useUtils();
  const { data: overrides } = trpc.particular.listOverrides.useQuery({ particularId });
  const del = trpc.particular.deleteOverride.useMutation({
    onSuccess: () => { utils.particular.listOverrides.invalidate({ particularId }); utils.forecast.getData.invalidate(); },
  });

  if (!overrides?.length) return <p className="text-sm text-muted-foreground">No overrides.</p>;
  return (
    <div className="space-y-2">
      {overrides.map((o) => (
        <div key={o.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
          <span>
            {format(new Date(o.originalDate), "MMM d, yyyy")}
            {o.isSkipped ? " — skipped"
              : o.overriddenAmount != null ? ` — ${formatCurrency(Number(o.overriddenAmount))}`
              : o.overriddenDate ? ` — moved to ${format(new Date(o.overriddenDate), "MMM d")}` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => del.mutate({ id: o.id })}>Revert</Button>
        </div>
      ))}
    </div>
  );
}
```

`app/particulars/page.tsx` (Client Component — list shell):
```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { ParticularForm } from "./ParticularForm";
import { OverrideManagement } from "./OverrideManagement";

export default function ParticularsPage() {
  const utils = trpc.useUtils();
  const { data: particulars, isLoading } = trpc.particular.list.useQuery();
  const del = trpc.particular.delete.useMutation({
    onSuccess: () => { utils.particular.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Income &amp; Expenses</h1>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>Add</Button>
        </div>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (
          <div className="space-y-2">
            {(particulars ?? []).map((p) => {
              const signed = p.type === "EXPENSE" ? -Math.abs(Number(p.amount)) : Math.abs(Number(p.amount));
              return (
                <div key={p.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <button className="text-left" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.frequency}</span>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className={signed < 0 ? "text-finance-expense" : "text-finance-income"}>
                        {formatCurrency(signed)}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(p.id); setFormOpen(true); }}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => del.mutate({ id: p.id })}>Delete</Button>
                    </div>
                  </div>
                  {expanded === p.id && <div className="mt-2"><OverrideManagement particularId={p.id} /></div>}
                </div>
              );
            })}
          </div>
        )}
        {formOpen && (
          <ParticularForm isOpen={formOpen} particularId={editing} onClose={() => setFormOpen(false)} />
        )}
      </div>
    </Layout>
  );
}
```

- [ ] **Step 3: Implement Holidays + Login pages**

`app/holidays/page.tsx` (Client Component):
```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { format } from "date-fns";

export default function HolidaysPage() {
  const utils = trpc.useUtils();
  const { data: holidays } = trpc.holiday.list.useQuery();
  const create = trpc.holiday.create.useMutation({
    onSuccess: () => { utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const del = trpc.holiday.delete.useMutation({
    onSuccess: () => { utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const [name, setName] = useState(""); const [date, setDate] = useState(""); const [recurring, setRecurring] = useState(false);

  return (
    <Layout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Holidays</h1>
        <form className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); create.mutate({ name, date: new Date(date), isRecurring: recurring }); setName(""); setDate(""); }}>
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="flex items-center gap-1 text-sm">
            <Checkbox checked={recurring} onCheckedChange={(c) => setRecurring(!!c)} /> Recurring
          </label>
          <Button type="submit" size="sm">Add</Button>
        </form>
        <div className="space-y-2">
          {(holidays ?? []).map((h) => (
            <div key={h.id} className="flex justify-between rounded-md border p-3">
              <span>{h.name} — {format(new Date(h.date), "MMM d, yyyy")}{h.isRecurring ? " (yearly)" : ""}</span>
              <Button variant="ghost" size="sm" onClick={() => del.mutate({ id: h.id })}>Delete</Button>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
```

`app/login/page.tsx` (Server Component — uses the NextAuth sign-in route):
```tsx
export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <a href="/api/auth/signin"
         className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Sign in</a>
    </div>
  );
}
```

- [ ] **Step 4: Verify it builds**

Run (from repo root): `npx next build`
Expected: build succeeds; `/particulars`, `/holidays`, `/login` compile.

- [ ] **Step 5: Commit**

```bash
git add app/_providers app/particulars app/holidays app/login
git commit -m "feat(client): active account provider, particulars, holidays, login pages"
```

---

### Task 16: Dashboard/forecast page (runs the engine locally) + client mapper

**Files:**
- Create: `lib/toEngine.ts`
- Test: `lib/toEngine.test.ts`
- Modify: `app/page.tsx` (replace placeholder with the Dashboard)
- Create: `app/_components/dashboard/MetricCard.tsx`, `DailyCard.tsx`, `OverrideModal.tsx`, `DangerNotification.tsx`, `BalanceSparkline.tsx`, `UpdateBalanceModal.tsx`, `SkipTodayButton.tsx`

**Interfaces:**
- Consumes: `trpc.forecast.getData`; `computeForecast` from `@/lib/engine`; `useActiveAccount`; ported `ui/*`.
- Produces:
  - `toEngineInputs(data)` mapping the `forecast.getData` response → `{ particulars: EngineParticular[]; holidays: EngineHoliday[]; anchorBalance: number; anchorDate: Date }`
  - A Dashboard (Client Component) that computes balances client-side with today→+3-months horizon and load-more, rendering the ported widgets.

- [ ] **Step 1: Write the failing test for the client mapper**

`lib/toEngine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toEngineInputs } from "./toEngine";

describe("toEngineInputs", () => {
  it("maps forecast.getData rows to engine inputs with positive amounts", () => {
    const out = toEngineInputs({
      account: { currentBalance: 1000, balanceUpdatedAt: new Date("2026-07-01") },
      particulars: [{
        id: "p1", name: "Rent", type: "EXPENSE", amount: "1500", frequency: "MONTHLY",
        startDate: new Date("2026-07-01"), endDate: null, isCritical: true, isFixed: true,
        businessDayAdjustment: "NONE", overrides: [],
      }],
      holidays: [{ date: new Date("2026-12-25"), isRecurring: true }],
    } as never);
    expect(out.anchorBalance).toBe(1000);
    expect(out.particulars[0]!.amount).toBe(1500);
    expect(out.holidays[0]!.isRecurring).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run lib/toEngine.test.ts`
Expected: FAIL — cannot find module `./toEngine`.

- [ ] **Step 3: Implement the client mapper**

`lib/toEngine.ts`:
```ts
import type { EngineParticular, EngineHoliday } from "@/lib/engine";

type Row = {
  account: { currentBalance: number; balanceUpdatedAt: Date };
  particulars: Array<{
    id: string; name: string; type: "INCOME" | "EXPENSE"; amount: string | number;
    frequency: EngineParticular["frequency"]; startDate: Date; endDate: Date | null;
    isCritical: boolean; isFixed: boolean; businessDayAdjustment: EngineParticular["businessDayAdjustment"];
    overrides: Array<{ id: string; originalDate: Date; overriddenDate: Date | null;
      overriddenAmount: string | number | null; isSkipped: boolean }>;
  }>;
  holidays: Array<{ date: Date; isRecurring: boolean }>;
};

const num = (v: string | number) => (typeof v === "number" ? v : Number(v));

export function toEngineInputs(data: Row) {
  const particulars: EngineParticular[] = data.particulars.map((p) => ({
    id: p.id, name: p.name, type: p.type, amount: Math.abs(num(p.amount)),
    frequency: p.frequency, startDate: new Date(p.startDate),
    endDate: p.endDate ? new Date(p.endDate) : null,
    isCritical: p.isCritical, isFixed: p.isFixed, businessDayAdjustment: p.businessDayAdjustment,
    overrides: p.overrides.map((o) => ({
      id: o.id, originalDate: new Date(o.originalDate),
      overriddenDate: o.overriddenDate ? new Date(o.overriddenDate) : null,
      overriddenAmount: o.overriddenAmount === null ? null : Math.abs(num(o.overriddenAmount)),
      isSkipped: o.isSkipped,
    })),
  }));
  const holidays: EngineHoliday[] = data.holidays.map((h) => ({ date: new Date(h.date), isRecurring: h.isRecurring }));
  return {
    anchorBalance: data.account.currentBalance,
    anchorDate: new Date(data.account.balanceUpdatedAt),
    particulars, holidays,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/toEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the dashboard widgets**

Create the small presentational widgets. Keep markup faithful to the original UX (cards + finance-semantic colors). These take fully-computed props (no data fetching inside).

`app/_components/dashboard/MetricCard.tsx`:
```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";

export function MetricCard(
  { title, value, subtitle, type }:
  { title: string; value: number; subtitle?: string; type: "income" | "expense" | "warning" },
) {
  const color = type === "income" ? "text-finance-income" : type === "expense" ? "text-finance-expense" : "text-finance-warning";
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${color}`}>{formatCurrency(value)}</div>
        {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      </CardContent>
    </Card>
  );
}
```

`app/_components/dashboard/DailyCard.tsx`:
```tsx
import type { DailyBalance } from "@/lib/engine";
import { Card, CardContent } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";

export function DailyCard({ day, onEventClick }: { day: DailyBalance; onEventClick?: (particularId: string, originalDate?: Date) => void }) {
  return (
    <Card className={day.isNegative ? "border-finance-expense" : undefined}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="font-medium">{format(day.date, "EEE, MMM d")}</span>
          <span className={day.closingBalance < 0 ? "text-finance-expense" : "text-foreground"}>
            {formatCurrency(day.closingBalance)}
          </span>
        </div>
        {day.events.length > 0 && (
          <ul className="mt-2 space-y-1">
            {day.events.map((e, i) => (
              <li key={`${e.particularId}-${i}`}
                  className="flex cursor-pointer justify-between text-sm"
                  onClick={() => onEventClick?.(e.particularId, e.originalDate)}>
                <span>
                  {e.name}
                  {e.isOverridden && <span className="ml-1 text-xs text-finance-warning">(edited)</span>}
                  {e.isMovedDueToHoliday && <span className="ml-1 text-xs text-muted-foreground">(moved)</span>}
                </span>
                <span className={e.amount < 0 ? "text-finance-expense" : "text-finance-income"}>
                  {formatCurrency(e.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

`app/_components/dashboard/DangerNotification.tsx`:
```tsx
import type { DailyBalance } from "@/lib/engine";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";

export function DangerNotification({ negativeBalance }: { negativeBalance: DailyBalance }) {
  return (
    <div className="rounded-md border border-finance-expense bg-finance-expense/10 p-3 text-sm">
      ⚠ Balance goes negative on {format(negativeBalance.date, "MMM d, yyyy")} ({formatCurrency(negativeBalance.closingBalance)}).
    </div>
  );
}
```

`app/_components/dashboard/SkipTodayButton.tsx`:
```tsx
"use client";

import { Button } from "@/app/_components/ui/button";

export function SkipTodayButton({ skipToday, onToggle }: { skipToday: boolean; onToggle: () => void }) {
  return (
    <Button variant={skipToday ? "default" : "outline"} size="sm" onClick={onToggle}>
      {skipToday ? "Skipping today" : "Skip today"}
    </Button>
  );
}
```

`app/_components/dashboard/BalanceSparkline.tsx`:
```tsx
"use client";

import type { DailyBalance } from "@/lib/engine";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

export function BalanceSparkline({ days }: { days: DailyBalance[] }) {
  const data = days.map((d) => ({ v: d.closingBalance }));
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line type="monotone" dataKey="v" dot={false} strokeWidth={2} stroke="currentColor" />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

`app/_components/dashboard/UpdateBalanceModal.tsx`:
```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";

export function UpdateBalanceModal(
  { isOpen, current, onClose }: { isOpen: boolean; current: number; onClose: () => void },
) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(String(current));
  const update = trpc.account.updateBalance.useMutation({
    onSuccess: () => { utils.account.get.invalidate(); utils.forecast.getData.invalidate(); onClose(); },
  });
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Update current balance</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); update.mutate({ balance: Number(value) }); }}>
          <Input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`app/_components/dashboard/OverrideModal.tsx`:
```tsx
"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";

export function OverrideModal(
  { isOpen, particularId, originalDate, isFixed, isCritical, onClose }:
  { isOpen: boolean; particularId: string; originalDate: Date; isFixed: boolean; isCritical: boolean; onClose: () => void },
) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [skip, setSkip] = useState(false);
  const override = trpc.particular.overrideInstance.useMutation({
    onSuccess: () => { utils.forecast.getData.invalidate(); utils.particular.listOverrides.invalidate({ particularId }); onClose(); },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Override this occurrence</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          override.mutate({
            particularId, originalDate,
            overriddenAmount: amount ? Number(amount) : undefined,
            overriddenDate: date ? new Date(date) : undefined,
            isSkipped: skip,
          });
        }}>
          {!isFixed && (
            <div className="space-y-1">
              <label className="text-sm">New amount</label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          {!isCritical && (
            <>
              <div className="space-y-1">
                <label className="text-sm">Move to date</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={skip} onCheckedChange={(c) => setSkip(!!c)} /> Skip this occurrence
              </label>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Implement the Dashboard page**

`app/page.tsx` (replace placeholder):
```tsx
"use client";

import { useMemo, useState } from "react";
import { addMonths, startOfDay } from "date-fns";
import { trpc } from "@/trpc/client";
import { computeForecast } from "@/lib/engine";
import { toEngineInputs } from "@/lib/toEngine";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { MetricCard } from "@/app/_components/dashboard/MetricCard";
import { DailyCard } from "@/app/_components/dashboard/DailyCard";
import { DangerNotification } from "@/app/_components/dashboard/DangerNotification";
import { SkipTodayButton } from "@/app/_components/dashboard/SkipTodayButton";
import { BalanceSparkline } from "@/app/_components/dashboard/BalanceSparkline";
import { UpdateBalanceModal } from "@/app/_components/dashboard/UpdateBalanceModal";
import { OverrideModal } from "@/app/_components/dashboard/OverrideModal";

export default function DashboardPage() {
  const today = startOfDay(new Date());
  const [monthsAhead, setMonthsAhead] = useState(3);
  const [skipToday, setSkipToday] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [override, setOverride] = useState<{ particularId: string; originalDate: Date; isFixed: boolean; isCritical: boolean } | null>(null);

  const viewStart = today;
  const viewEnd = addMonths(today, monthsAhead);

  const { data, isLoading } = trpc.forecast.getData.useQuery({ viewStart, viewEnd });
  const { data: particulars } = trpc.particular.list.useQuery();

  const result = useMemo(() => {
    if (!data) return null;
    const inputs = toEngineInputs(data as never);
    return computeForecast({ ...inputs, viewStart, viewEnd, today, skipToday });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, monthsAhead, skipToday]);

  if (isLoading || !result) return <Layout><p className="text-muted-foreground">Loading…</p></Layout>;

  const current = result.days[0]?.openingBalance ?? 0;
  const thisMonth = result.months[0];

  const openOverride = (particularId: string, originalDate?: Date) => {
    if (!originalDate) return;
    const p = particulars?.find((x) => x.id === particularId);
    if (!p) return;
    setOverride({ particularId, originalDate, isFixed: p.isFixed, isCritical: p.isCritical });
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setBalanceOpen(true)}>Update balance</Button>
            <SkipTodayButton skipToday={skipToday} onToggle={() => setSkipToday((s) => !s)} />
          </div>
        </div>

        {result.firstNegative && <DangerNotification negativeBalance={result.firstNegative} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Current Balance" value={current} type={current >= 0 ? "income" : "expense"} />
          <MetricCard title="Lowest Balance" value={result.lowest?.closingBalance ?? 0}
            type={(result.lowest?.closingBalance ?? 0) >= 0 ? "income" : "expense"} />
          <MetricCard title="Next Negative" value={result.firstNegative?.closingBalance ?? 0} type="warning" />
          <MetricCard title="This Month" value={thisMonth?.netChange ?? 0}
            subtitle={`${formatCurrency(thisMonth?.totalIncome ?? 0)} in, ${formatCurrency(thisMonth?.totalExpenses ?? 0)} out`}
            type={(thisMonth?.netChange ?? 0) >= 0 ? "income" : "expense"} />
        </div>

        <div className="text-foreground"><BalanceSparkline days={result.days} /></div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Daily Transactions</h2>
          {result.days.map((day) => (
            <DailyCard key={day.date.toISOString()} day={day} onEventClick={openOverride} />
          ))}
        </div>

        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setMonthsAhead((m) => m + 1)}>Load next month</Button>
        </div>
      </div>

      {balanceOpen && <UpdateBalanceModal isOpen={balanceOpen} current={current} onClose={() => setBalanceOpen(false)} />}
      {override && (
        <OverrideModal isOpen={!!override} {...override} onClose={() => setOverride(null)} />
      )}
    </Layout>
  );
}
```

- [ ] **Step 7: Verify build + commit**

Run (from repo root): `npx next build`
Expected: build succeeds.

```bash
git add lib/toEngine.ts lib/toEngine.test.ts app/page.tsx app/_components/dashboard
git commit -m "feat(client): dashboard forecast page running the engine locally"
```

---

### Task 17: Provision DB, end-to-end smoke, run docs

**Files:**
- Create: `README.md` (run instructions — overwrite the seed README)

**Interfaces:**
- Produces: a documented, runnable app; `npm test` green across engine + server + client units; manual full-stack smoke verified.

- [ ] **Step 1: Provision the database**

Copy `.env.example` → `.env`, set a real `DATABASE_URL` and `AUTH_SECRET` (`openssl rand -base64 32`), then:
Run (from repo root): `npm run db:push`
Expected: schema synced to Postgres.

- [ ] **Step 2: Configure at least one auth provider**

`server/auth.ts` ships with `providers: []`. Add a real provider (matching the original app — e.g. an OAuth provider or the email magic-link provider) so sign-in works. Set the provider's env vars in `.env`. This is required for the smoke test's sign-in step.

- [ ] **Step 3: Write the run docs**

`README.md`:
```markdown
# Future Finance v2

Single-user financial forecaster (Next.js App Router).

## Setup
1. `npm install`
2. Copy `.env.example` → `.env`; set `DATABASE_URL`, `AUTH_SECRET`, and your auth provider vars.
3. `npm run db:push`
4. `npm run dev` → http://localhost:3000

## Architecture
- `lib/engine/` — pure forecast engine (no React/DB), run on both server and client.
- `lib/schemas/` — shared Zod schemas.
- `server/` — tRPC routers, Prisma, NextAuth (server-only).
- `app/` — Next.js App Router pages + `/api/trpc` and `/api/auth` route handlers.

## Test
`npm test` (Vitest) — engine, server, and client units.
```

- [ ] **Step 4: Full-stack smoke test**

> Per local convention, dev may already be running on port 3000 (`dev.log`). Otherwise `npm run dev`.
In the browser at `http://localhost:3000`:
- Sign in via `/login` → `/api/auth/signin`; the account auto-creates on the first authenticated request.
- Add an income and an expense on `/particulars`; confirm they appear on the dashboard daily cards with correct signs.
- Update the balance; confirm projected balances re-anchor.
- Add a future recurring expense large enough to go negative; confirm the danger notification and "Next Negative" metric appear.
- Click a daily event for a flexible/adjustable particular; override it; confirm the dashboard recomputes instantly.
- Click "Load next month"; confirm an extra month renders and its opening balance reflects all prior events.
Expected: all behaviors correct.

- [ ] **Step 5: Run the full test suite**

Run (from repo root): `npm test -- run`
Expected: engine, server, and client unit tests all pass.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "chore: db provisioning notes and run docs"
```

---

## Self-Review

**Spec coverage:**
- Single Next.js app, one origin → Tasks 1, 11, 13.
- Single-user auth (NextAuth v5 + Prisma adapter, database session) → Tasks 7, 9, 11.
- One FinanceAccount per user, growth-shaped (`ownerId @unique`) → Task 7; auto-create on first authenticated request → Task 9 (`resolveAccount`).
- Particulars + recurrence + critical/flexible + fixed/adjustable + business-day → Tasks 2–4 (engine), 7 (schema), 10 (router), 15 (UI).
- Holidays (one-time + recurring) → Tasks 3, 7, 10, 15.
- Per-instance overrides (amount/date/skip) keyed by `(particularId, originalDate)`, validation server-side → Tasks 4 (engine), 6/10 (schema + `assertOverrideAllowed`), 16 (override modal).
- Pure engine run on both sides → Tasks 1–5 (engine), 8 (server mapper), 16 (client mapper + `computeForecast` in the dashboard).
- Anchored replay fix → Task 5 (explicit test: future window reflects pre-viewStart events) + Task 10 `forecast.getData` window.
- tRPC 11 via App Router fetch handler → Task 11.
- Dashboard widgets (metric cards, danger, lowest, skip today, sparkline, daily cards, update balance) → Task 16.
- Theme port + token consolidation → Task 12 (globals.css verbatim, helpers-only design-system); primitives → Task 14.
- App shell responsive (`next/link`/`usePathname`) → Task 14.
- Today→+3-months horizon + load-more → Task 16.
- Zod 4 schemas shared both sides → Task 6, consumed in 10 and 15.
- Vitest everywhere; no Playwright → Tasks 1, 16, and all test steps.

**Placeholder scan:** No "TBD/TODO/handle edge cases" in steps; every code step shows complete code. The intentional design TBD (debt) is out of scope and absent. Task 17 Step 2 (add a real auth provider) is a deliberate, scoped configuration action, not a placeholder — the original app's provider choice carries over.

**Type consistency:** `EngineParticular`/`EngineHoliday`/`EngineOverride`/`DailyBalance`/`DailyEvent`/`MonthlySummary` (Task 2) are used unchanged in Tasks 3–5, 8, 16. `computeForecast`'s `ForecastInput` (Task 5) matches the dashboard call site (Task 16). `assertOverrideAllowed` signature (Task 10 test ↔ impl) matches. `resolveAccount(userId)` (Task 9) matches all router call sites (Task 10). `trpc` client type `AppRouter` (Task 10 export) matches the client import (Tasks 13–16). `toEngineInputs` return shape (Task 16) matches `computeForecast` inputs (Task 5).

**Known intentional divergences from the original app (not bugs):**
1. DB stores `amount` positive (sign from `type`); the engine/mappers apply the sign.
2. Forecast horizon today→+3mo (original: −30/+14).
3. `server/auth.ts` ships with an empty providers list — fill in the real provider(s) (Task 17 Step 2) before production sign-in works.
4. NextAuth v5 is the beta (`5.0.0-beta.31`) by design; there is no stable v5.
</content>
