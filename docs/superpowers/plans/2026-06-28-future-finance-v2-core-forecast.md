# Future Finance v2 — Core Forecast Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean, single-user financial forecaster from scratch: a pure forecast engine, an Express+tRPC+Prisma API, and a Vite React SPA that ports the current app's UX.

**Architecture:** Three parts in one repo — a pure `lib/engine/` (no React, no DB, deterministic) imported by both sides; a standalone Express server hosting tRPC + Prisma + Auth.js; and a Vite React SPA (React Router) that runs the engine locally for instant recompute. The forecast always replays from the account's `balanceUpdatedAt` (seeded with `currentBalance`) forward to the visible window, then slices for display.

**Tech Stack:** TypeScript, Vite, React 19, React Router, Vitest, Express, tRPC 11, Prisma 6, PostgreSQL, Auth.js, Tailwind v4, Radix/shadcn UI, Zod, React Query, date-fns, recharts, lucide-react.

**Source spec:** `docs/superpowers/specs/2026-06-28-future-finance-v2-core-forecast-design.md`

## Global Constraints

- The new app lives in a fresh folder: `app-v2/` at the repo root (keeps the old app intact for reference). All paths below are relative to `app-v2/` unless stated otherwise.
- `lib/engine/` and `lib/schemas/` MUST NOT import React, Prisma, Express, or any DB/runtime client. Engine functions are deterministic: "today" and "skip today" are passed in as parameters, never read from the clock.
- Sign convention: `Particular.amount` is stored **positive** in the DB; the sign is applied from `type` (INCOME = +, EXPENSE = −) inside the engine. (This intentionally differs from the old app, which stored expenses negative.)
- Overrides are matched to instances by `(particularId, originalDate)` using a UTC year/month/day compare (ignore time).
- One `FinanceAccount` per user, enforced by `ownerId @unique`. Do not add multi-account, collaboration, or debt models.
- Forecast default horizon: today → +3 months, with load-more appending one month.
- Currency formatting: NZD via `Intl.NumberFormat('en-NZ', ...)`.
- Every tRPC procedure is `protectedProcedure` scoped to the caller's single account.
- Test runner is Vitest everywhere. No Playwright in this slice.
- TDD: write the failing test, see it fail, implement minimally, see it pass, commit.

---

## File Structure

```
app-v2/
  package.json                 root scripts (dev runs client+server concurrently)
  tsconfig.base.json           shared TS config; project references
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
  server/
    package.json
    tsconfig.json
    src/
      db.ts                    Prisma client singleton
      auth.ts                  Auth.js config (Express handler)
      trpc.ts                  tRPC init, context, protectedProcedure, resolveAccount
      mappers.ts               Prisma rows -> Engine* types
      routers/
        account.ts
        particular.ts
        holiday.ts
        forecast.ts
        _app.ts                appRouter (root) + AppRouter type export
      index.ts                 Express app: mounts /api/auth, /api/trpc
  client/
    package.json
    tsconfig.json
    vite.config.ts             server.proxy['/api'] -> http://localhost:3001
    index.html
    src/
      main.tsx                 React root + Router + tRPC/React Query providers
      trpc.ts                  tRPC React client
      router.tsx               route definitions
      styles/globals.css       ported theme tokens
      lib/design-system.ts     helpers only (formatCurrency, color classes, etc.)
      components/ui/*           shadcn/Radix components (ported)
      components/theme-provider.tsx, theme-toggle.tsx
      components/Layout.tsx, Sidebar.tsx, BottomNav.tsx
      pages/
        Dashboard.tsx + dashboard widgets
        Particulars.tsx + ParticularForm, OverrideManagement
        Holidays.tsx
        Login.tsx
      providers/ActiveAccountProvider.tsx
```

---

## Phase 1 — Repo scaffold & engine (the testable heart)

### Task 1: Scaffold the monorepo root + engine package with Vitest

**Files:**
- Create: `app-v2/package.json`
- Create: `app-v2/tsconfig.base.json`
- Create: `app-v2/vitest.config.ts`
- Create: `app-v2/lib/engine/index.ts`
- Test: `app-v2/lib/engine/smoke.test.ts`

**Interfaces:**
- Produces: a working `npm test` (Vitest) at `app-v2/` root that discovers `lib/**/*.test.ts`.

- [ ] **Step 1: Write the failing smoke test**

`app-v2/lib/engine/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("engine package", () => {
  it("exposes a version constant", () => {
    expect(ENGINE_VERSION).toBe("v2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `app-v2/`): `npm test -- run lib/engine/smoke.test.ts`
Expected: FAIL — cannot find module `./index` / `ENGINE_VERSION` undefined.

(If npm isn't set up yet, first create the files in Steps 3–4, then run.)

- [ ] **Step 3: Create root config files**

`app-v2/package.json`:
```json
{
  "name": "future-finance-v2",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest",
    "typecheck": "tsc -p tsconfig.base.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "date-fns": "^4.1.0"
  }
}
```

`app-v2/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["lib"]
}
```

`app-v2/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { globals: true, include: ["lib/**/*.test.ts"] },
});
```

- [ ] **Step 4: Implement minimal engine index**

`app-v2/lib/engine/index.ts`:
```ts
export const ENGINE_VERSION = "v2" as const;
```

- [ ] **Step 5: Install and run the test**

Run (from `app-v2/`): `npm install && npm test -- run`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add app-v2/package.json app-v2/tsconfig.base.json app-v2/vitest.config.ts app-v2/lib/engine
git commit -m "chore: scaffold v2 monorepo root and engine package with vitest"
```

---

### Task 2: Engine types

**Files:**
- Create: `app-v2/lib/engine/types.ts`
- Modify: `app-v2/lib/engine/index.ts` (add export)
- Test: `app-v2/lib/engine/types.test.ts`

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

`app-v2/lib/engine/types.test.ts`:
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

`app-v2/lib/engine/types.ts`:
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

`app-v2/lib/engine/index.ts` (append):
```ts
export * from "./types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/engine/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app-v2/lib/engine/types.ts app-v2/lib/engine/types.test.ts app-v2/lib/engine/index.ts
git commit -m "feat(engine): add plain engine types"
```

---

### Task 3: Date helpers (business day + holiday expansion)

**Files:**
- Create: `app-v2/lib/engine/dates.ts`
- Modify: `app-v2/lib/engine/index.ts` (add export)
- Test: `app-v2/lib/engine/dates.test.ts`

**Interfaces:**
- Consumes: `EngineHoliday`, `BdaAdjustment` from `./types`.
- Produces:
  - `isBusinessDay(date: Date, holidays: EngineHoliday[]): boolean`
  - `adjustToBusinessDay(date: Date, adjustment: BdaAdjustment, holidays: EngineHoliday[]): Date`
  - `expandRecurringHolidays(holidays: EngineHoliday[], start: Date, end: Date): Date[]`

- [ ] **Step 1: Write the failing tests**

`app-v2/lib/engine/dates.test.ts`:
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

`app-v2/lib/engine/dates.ts`:
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
  const step = adjustment === "NEXT_BUSINESS_DAY" ? 1 : -1;
  let d = date;
  while (!isBusinessDay(d, holidays)) d = addDays(d, step);
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

`app-v2/lib/engine/index.ts` (append):
```ts
export * from "./dates";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/engine/dates.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app-v2/lib/engine/dates.ts app-v2/lib/engine/dates.test.ts app-v2/lib/engine/index.ts
git commit -m "feat(engine): business-day and holiday date helpers"
```

---

### Task 4: Instance generation (recurrence + overrides + business-day)

**Files:**
- Create: `app-v2/lib/engine/instances.ts`
- Modify: `app-v2/lib/engine/index.ts` (add export)
- Test: `app-v2/lib/engine/instances.test.ts`

**Interfaces:**
- Consumes: `EngineParticular`, `EngineHoliday`, `EngineOverride`, `Instance` from `./types`; `adjustToBusinessDay` from `./dates`.
- Produces: `generateInstances(p: EngineParticular, viewStart: Date, viewEnd: Date, holidays: EngineHoliday[]): Instance[]`
  - Emits **signed** amounts (EXPENSE negated). Steps recurrence from `startDate`. Applies overrides (skip / amount / date) matched by UTC date. Applies business-day adjustment only when there is no `overriddenDate`.

- [ ] **Step 1: Write the failing tests**

`app-v2/lib/engine/instances.test.ts`:
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

`app-v2/lib/engine/instances.ts`:
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

`app-v2/lib/engine/index.ts` (append):
```ts
export * from "./instances";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/engine/instances.test.ts`
Expected: PASS (all 9 cases).

- [ ] **Step 5: Commit**

```bash
git add app-v2/lib/engine/instances.ts app-v2/lib/engine/instances.test.ts app-v2/lib/engine/index.ts
git commit -m "feat(engine): instance generation with recurrence, overrides, business-day"
```

---

### Task 5: Anchored forecast replay + monthly/lowest/first-negative

**Files:**
- Create: `app-v2/lib/engine/forecast.ts`
- Modify: `app-v2/lib/engine/index.ts` (add export)
- Test: `app-v2/lib/engine/forecast.test.ts`

**Interfaces:**
- Consumes: `generateInstances` from `./instances`; types from `./types`.
- Produces:
  - `computeForecast(input: ForecastInput): ForecastResult`
  - `ForecastInput { anchorBalance:number; anchorDate:Date; viewStart:Date; viewEnd:Date; today:Date; skipToday:boolean; particulars:EngineParticular[]; holidays:EngineHoliday[] }`
  - `ForecastResult { days:DailyBalance[]; months:MonthlySummary[]; firstNegative:DailyBalance|null; lowest:DailyBalance|null }`
  - Replays day-by-day from `min(anchorDate, viewStart)` through `viewEnd`, seeded with `anchorBalance`; returns only days within `[viewStart, viewEnd]`. `skipToday` drops events whose day equals `today`.

- [ ] **Step 1: Write the failing tests**

`app-v2/lib/engine/forecast.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeForecast } from "./forecast";
import type { EngineParticular, ForecastInput } from "./types";
import type {} from "./forecast";

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

`app-v2/lib/engine/forecast.ts`:
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
    firstNegative: days.find((d) => d.isNegative) ?? null,
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

Also add to `app-v2/lib/engine/types.ts` (append) so tests can import the input type from `./types`:
```ts
export type { ForecastInput, ForecastResult } from "./forecast";
```

`app-v2/lib/engine/index.ts` (append):
```ts
export * from "./forecast";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run lib/engine/forecast.test.ts`
Expected: PASS (all 7 cases). Then run the full suite: `npm test -- run` → all engine tests green.

- [ ] **Step 5: Commit**

```bash
git add app-v2/lib/engine
git commit -m "feat(engine): anchored forecast replay with monthly/lowest/first-negative"
```

---

### Task 6: Shared Zod schemas

**Files:**
- Create: `app-v2/lib/schemas/particular.ts`
- Create: `app-v2/lib/schemas/holiday.ts`
- Create: `app-v2/lib/schemas/account.ts`
- Create: `app-v2/lib/schemas/index.ts`
- Test: `app-v2/lib/schemas/particular.test.ts`
- Modify: `app-v2/package.json` (add `zod` dependency)

**Interfaces:**
- Produces (all importable without Prisma/React):
  - `particularInput` Zod schema → `{ name, type:'INCOME'|'EXPENSE', amount>0, frequency, startDate, endDate?, isCritical, isFixed, businessDayAdjustment }`
  - `overrideInstanceInput` → `{ particularId, originalDate, overriddenAmount?, overriddenDate?, isSkipped }`
  - `holidayInput` → `{ name, date, isRecurring }`
  - `updateBalanceInput` → `{ balance }`

- [ ] **Step 1: Add zod and write the failing test**

Add `"zod": "^3.23.0"` to `app-v2/package.json` dependencies, then run `npm install`.

`app-v2/lib/schemas/particular.test.ts`:
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

`app-v2/lib/schemas/particular.ts`:
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

`app-v2/lib/schemas/holiday.ts`:
```ts
import { z } from "zod";
export const holidayInput = z.object({
  name: z.string().min(1).max(200),
  date: z.coerce.date(),
  isRecurring: z.boolean().default(false),
});
export type HolidayInput = z.infer<typeof holidayInput>;
```

`app-v2/lib/schemas/account.ts`:
```ts
import { z } from "zod";
export const updateBalanceInput = z.object({ balance: z.number() });
export type UpdateBalanceInput = z.infer<typeof updateBalanceInput>;
```

`app-v2/lib/schemas/index.ts`:
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
git add app-v2/lib/schemas app-v2/package.json app-v2/package-lock.json
git commit -m "feat(schemas): shared zod input schemas"
```

---

## Phase 2 — Server (Prisma, Auth.js, tRPC, Express)

> Server tasks run from `app-v2/server/`. The server is its own package referencing `../lib`. Use `tsx` for dev. Tests use Vitest with a mocked Prisma client (no live DB needed for router unit tests); the mapper test is pure.

### Task 7: Prisma schema + client singleton

**Files:**
- Create: `app-v2/prisma/schema.prisma`
- Create: `app-v2/server/package.json`
- Create: `app-v2/server/tsconfig.json`
- Create: `app-v2/server/src/db.ts`
- Create: `app-v2/.env.example`

**Interfaces:**
- Produces: `prisma` client singleton exported from `server/src/db.ts`; generated types for `Particular`, `ParticularOverride`, `Holiday`, `FinanceAccount`.

- [ ] **Step 1: Write the Prisma schema**

`app-v2/prisma/schema.prisma`:
```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

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
  currentBalance   Decimal  @db.Decimal(15, 2) @default(0)
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

- [ ] **Step 2: Create server package + config**

`app-v2/server/package.json`:
```json
{
  "name": "future-finance-v2-server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "db:push": "prisma db push --schema ../prisma/schema.prisma",
    "db:generate": "prisma generate --schema ../prisma/schema.prisma",
    "test": "vitest"
  },
  "dependencies": {
    "@prisma/client": "^6.5.0",
    "@trpc/server": "^11.0.0",
    "@auth/express": "^0.7.0",
    "@auth/prisma-adapter": "^2.7.2",
    "express": "^4.21.0",
    "zod": "^3.23.0",
    "superjson": "^2.2.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "prisma": "^6.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`app-v2/server/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "module": "ESNext",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "../lib"]
}
```

`app-v2/.env.example`:
```
DATABASE_URL="postgresql://postgres:password@localhost:5432/future_finance_v2"
AUTH_SECRET="generate-with-openssl-rand-base64-32"
AUTH_URL="http://localhost:5173"
```

- [ ] **Step 3: Implement the Prisma client singleton**

`app-v2/server/src/db.ts`:
```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["error", "warn"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: Install deps and generate the client**

Run (from `app-v2/server/`): `npm install && npm run db:generate`
Expected: Prisma client generated without errors. (A live DB is not required to generate.)

- [ ] **Step 5: Commit**

```bash
git add app-v2/prisma app-v2/server/package.json app-v2/server/tsconfig.json app-v2/server/src/db.ts app-v2/.env.example app-v2/server/package-lock.json
git commit -m "feat(server): prisma schema, client singleton, server package"
```

---

### Task 8: Prisma → Engine mappers

**Files:**
- Create: `app-v2/server/src/mappers.ts`
- Test: `app-v2/server/src/mappers.test.ts`

**Interfaces:**
- Consumes: Prisma row shapes for `Particular` (with `overrides`) and `Holiday`; `EngineParticular`, `EngineHoliday` from `../../lib/engine`.
- Produces:
  - `toEngineParticular(p: PrismaParticularWithOverrides): EngineParticular`
  - `toEngineHoliday(h: { date: Date; isRecurring: boolean }): EngineHoliday`
  - Converts `Decimal` (and stored sign) to a positive `number` amount; the engine applies the sign.

- [ ] **Step 1: Write the failing test**

`app-v2/server/src/mappers.test.ts`:
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

Run (from `app-v2/server/`): `npm test -- run src/mappers.test.ts`
Expected: FAIL — cannot find module `./mappers`.

- [ ] **Step 3: Implement the mappers**

`app-v2/server/src/mappers.ts`:
```ts
import type { EngineParticular, EngineHoliday, EngineOverride } from "../../lib/engine";

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

function toEngineOverride(o: PrismaOverride): EngineOverride {
  return {
    id: o.id, originalDate: o.originalDate, overriddenDate: o.overriddenDate,
    overriddenAmount: o.overriddenAmount === null ? null : Math.abs(num(o.overriddenAmount)),
    isSkipped: o.isSkipped,
  };
}

export function toEngineHoliday(h: { date: Date; isRecurring: boolean }): EngineHoliday {
  return { date: h.date, isRecurring: h.isRecurring };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run src/mappers.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add app-v2/server/src/mappers.ts app-v2/server/src/mappers.test.ts
git commit -m "feat(server): prisma-to-engine mappers"
```

---

### Task 9: Auth.js config + tRPC init (context, protectedProcedure, resolveAccount)

**Files:**
- Create: `app-v2/server/src/auth.ts`
- Create: `app-v2/server/src/trpc.ts`
- Test: `app-v2/server/src/trpc.test.ts`

**Interfaces:**
- Consumes: `prisma` from `./db`.
- Produces:
  - `authConfig` (Auth.js ExpressAuth config object) and `getSessionUser(req): Promise<{ id: string } | null>`
  - `createContext({ req }): Promise<{ user: { id: string } | null }>`
  - `router`, `publicProcedure`, `protectedProcedure` (throws `UNAUTHORIZED` when `ctx.user` is null)
  - `resolveAccount(userId): Promise<FinanceAccount>` — finds the user's single account, auto-creating it if missing.

- [ ] **Step 1: Write the failing test**

`app-v2/server/src/trpc.test.ts`:
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

import { resolveAccount } from "./trpc";

describe("resolveAccount", () => {
  it("auto-creates an account when the user has none", async () => {
    const acc = await resolveAccount("u1");
    expect(acc.id).toBe("acc1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- run src/trpc.test.ts`
Expected: FAIL — cannot find module `./trpc`.

- [ ] **Step 3: Implement auth + trpc**

`app-v2/server/src/auth.ts`:
```ts
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { ExpressAuthConfig } from "@auth/express";
import { getSession } from "@auth/express";
import { prisma } from "./db";

// Provider list intentionally minimal for the first slice; add OAuth/email providers here.
export const authConfig: ExpressAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [],
  secret: process.env.AUTH_SECRET,
};

export async function getSessionUser(
  req: { headers: Record<string, unknown> } & object
): Promise<{ id: string } | null> {
  const session = await getSession(req as never, authConfig);
  const id = (session?.user as { id?: string } | undefined)?.id;
  return id ? { id } : null;
}
```

`app-v2/server/src/trpc.ts`:
```ts
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Request } from "express";
import { prisma } from "./db";
import { getSessionUser } from "./auth";

export async function createContext({ req }: { req: Request }) {
  const user = await getSessionUser(req as never);
  return { user, prisma };
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- run src/trpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app-v2/server/src/auth.ts app-v2/server/src/trpc.ts app-v2/server/src/trpc.test.ts
git commit -m "feat(server): auth config, trpc init, resolveAccount"
```

---

### Task 10: tRPC routers (account, holiday, particular, forecast) + appRouter

**Files:**
- Create: `app-v2/server/src/routers/account.ts`
- Create: `app-v2/server/src/routers/holiday.ts`
- Create: `app-v2/server/src/routers/particular.ts`
- Create: `app-v2/server/src/routers/forecast.ts`
- Create: `app-v2/server/src/routers/_app.ts`
- Test: `app-v2/server/src/routers/particular.test.ts`

**Interfaces:**
- Consumes: `router`, `protectedProcedure`, `resolveAccount` from `../trpc`; schemas from `../../../lib/schemas`; mappers from `../mappers`.
- Produces: `appRouter` and `export type AppRouter = typeof appRouter` from `_app.ts`. Procedures listed in the spec's API surface. `particular.overrideInstance` enforces: amount override rejected if `isFixed`; date/skip rejected if `isCritical`.

- [ ] **Step 1: Write the failing test (override validation)**

`app-v2/server/src/routers/particular.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
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

Run: `npm test -- run src/routers/particular.test.ts`
Expected: FAIL — cannot find module `./particular`.

- [ ] **Step 3: Implement the routers**

`app-v2/server/src/routers/account.ts`:
```ts
import { router, protectedProcedure, resolveAccount } from "../trpc";
import { updateBalanceInput } from "../../../lib/schemas";

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

`app-v2/server/src/routers/holiday.ts`:
```ts
import { z } from "zod";
import { router, protectedProcedure, resolveAccount } from "../trpc";
import { holidayInput } from "../../../lib/schemas";

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

`app-v2/server/src/routers/particular.ts`:
```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, resolveAccount } from "../trpc";
import { particularInput, overrideInstanceInput } from "../../../lib/schemas";

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

`app-v2/server/src/routers/forecast.ts`:
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

`app-v2/server/src/routers/_app.ts`:
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

Run: `npm test -- run src/routers/particular.test.ts`
Expected: PASS (all 3 cases). Then `npm test -- run` (server) → green.

- [ ] **Step 5: Commit**

```bash
git add app-v2/server/src/routers
git commit -m "feat(server): account/holiday/particular/forecast routers"
```

---

### Task 11: Express app wiring (auth + trpc + dev server)

**Files:**
- Create: `app-v2/server/src/index.ts`

**Interfaces:**
- Consumes: `authConfig` from `./auth`; `appRouter`, `createContext` from routers/trpc.
- Produces: an Express server on port 3001 mounting `/api/auth/*` (ExpressAuth) and `/api/trpc/*` (tRPC). No new test (integration covered manually in Step 3).

- [ ] **Step 1: Implement the Express entrypoint**

`app-v2/server/src/index.ts`:
```ts
import express from "express";
import { ExpressAuth } from "@auth/express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { authConfig } from "./auth";
import { appRouter } from "./routers/_app";
import { createContext } from "./trpc";

const app = express();
app.set("trust proxy", true);

app.use("/api/auth/*", ExpressAuth(authConfig));

app.use(
  "/api/trpc",
  createExpressMiddleware({ router: appRouter, createContext }),
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
```

- [ ] **Step 2: Verify it compiles**

Run (from `app-v2/server/`): `npm run build`
Expected: `tsc` completes with no errors.

- [ ] **Step 3: Smoke-test the health route**

Run (from `app-v2/server/`): `npm run dev` in one terminal, then in another:
`curl -s http://localhost:3001/api/health`
Expected: `{"ok":true}`. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app-v2/server/src/index.ts
git commit -m "feat(server): express app wiring for auth + trpc"
```

---

## Phase 3 — Client (Vite SPA: theme port, providers, screens)

> Client tasks run from `app-v2/client/`. The client references `../lib` and the server's `AppRouter` type. Vite dev proxies `/api` → `localhost:3001`.

### Task 12: Vite SPA scaffold + theme port + tRPC/React Query providers

**Files:**
- Create: `app-v2/client/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `postcss.config.js`
- Create: `app-v2/client/src/main.tsx`, `src/trpc.ts`, `src/styles/globals.css`, `src/lib/design-system.ts`
- Create: `app-v2/client/src/App.tsx` (placeholder route shell)

**Interfaces:**
- Consumes: `AppRouter` type from `../../server/src/routers/_app`.
- Produces: a running Vite dev server (`npm run dev`) that renders a placeholder, with `trpc` React client + React Query provider wired and `/api` proxied to 3001.

- [ ] **Step 1: Create client package + config**

`app-v2/client/package.json`:
```json
{
  "name": "future-finance-v2-client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.69.0",
    "@trpc/client": "^11.0.0",
    "@trpc/react-query": "^11.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "superjson": "^2.2.1",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.546.0",
    "recharts": "^3.3.0",
    "react-hook-form": "^7.65.0",
    "@hookform/resolvers": "^5.2.2",
    "zod": "^3.23.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.0",
    "class-variance-authority": "^0.7.1"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "postcss": "^8.4.0",
    "tw-animate-css": "^1.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

`app-v2/client/vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "~": path.resolve(__dirname, "src"),
      "@lib": path.resolve(__dirname, "../lib"),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true } },
  },
});
```

`app-v2/client/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "paths": {
      "@/*": ["./src/*"],
      "~/*": ["./src/*"],
      "@lib/*": ["../lib/*"]
    }
  },
  "include": ["src", "../lib", "../server/src/routers/_app.ts"]
}
```

`app-v2/client/postcss.config.js`:
```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

`app-v2/client/index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Future Finance</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 2: Port theme files**

Copy `globals.css` verbatim from the old app into `app-v2/client/src/styles/globals.css`:

Run (from repo root):
`cp src/styles/globals.css app-v2/client/src/styles/globals.css`

Create `app-v2/client/src/lib/design-system.ts` (helpers only — the consolidated version):
```ts
export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
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

> Note: the old `cn` lives in `lib/utils.ts` using `clsx` + `tailwind-merge`. If you prefer that, port `lib/utils.ts` instead and import `cn` from there; the shadcn `ui/*` components expect `cn` at `@/lib/utils`. To keep `ui/*` ports drop-in, ALSO create `app-v2/client/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

- [ ] **Step 3: Wire tRPC client + providers + placeholder app**

`app-v2/client/src/trpc.ts`:
```ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../server/src/routers/_app";
export const trpc = createTRPCReact<AppRouter>();
```

`app-v2/client/src/main.tsx`:
```tsx
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { BrowserRouter } from "react-router-dom";
import { trpc } from "./trpc";
import App from "./App";
import "./styles/globals.css";

function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter><App /></BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><Root /></React.StrictMode>,
);
```

`app-v2/client/src/App.tsx` (placeholder — replaced in Task 14):
```tsx
export default function App() {
  return <div className="p-6 text-foreground bg-background min-h-screen">Future Finance v2</div>;
}
```

- [ ] **Step 4: Install and verify dev server boots**

Run (from `app-v2/client/`): `npm install && npm run dev`
Expected: Vite serves at `http://localhost:5173`; page shows "Future Finance v2" with themed background. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add app-v2/client
git commit -m "feat(client): vite spa scaffold, theme port, trpc/react-query providers"
```

---

### Task 13: Port shared UI primitives + theme provider + app shell

**Files:**
- Create: `app-v2/client/src/components/ui/*` (ported shadcn components)
- Create: `app-v2/client/src/components/theme-provider.tsx`, `theme-toggle.tsx`
- Create: `app-v2/client/src/components/Layout.tsx`, `Sidebar.tsx`, `BottomNav.tsx`
- Create: `app-v2/client/components.json`

**Interfaces:**
- Produces: `Layout` (sidebar on desktop ≥768px, bottom-nav on mobile), themed `ui/*` primitives importing `cn` from `@/lib/utils`, and a `ThemeProvider` toggling the `.dark` class via localStorage.

- [ ] **Step 1: Port shadcn UI primitives**

Run (from repo root) to copy the component set and config:
```bash
cp -r src/components/ui app-v2/client/src/components/ui
cp components.json app-v2/client/components.json
```
These import `cn` from `@/lib/utils` (created in Task 12) and reference the CSS tokens already in `globals.css`. No code changes needed.

- [ ] **Step 2: Implement a Vite-compatible ThemeProvider + toggle**

`app-v2/client/src/components/theme-provider.tsx`:
```tsx
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) ?? "light",
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return (
    <ThemeCtx.Provider value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}>
      {children}
    </ThemeCtx.Provider>
  );
}
export const useTheme = () => useContext(ThemeCtx);
```

`app-v2/client/src/components/theme-toggle.tsx`:
```tsx
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "./theme-provider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
```

Wrap the app: in `main.tsx`, import `ThemeProvider` and wrap `<App />` (inside `BrowserRouter`).

- [ ] **Step 3: Port the app shell (Layout, Sidebar, BottomNav)**

Port `Layout.tsx`, `Sidebar.tsx`, `BottomNav.tsx` from `src/app/_components/` into `app-v2/client/src/components/`. Replace Next-specific bits:
- `next/link` → `Link` from `react-router-dom`
- `usePathname()` → `useLocation().pathname`
- Nav targets: `/` (Dashboard), `/particulars`, `/holidays`.

`app-v2/client/src/components/Layout.tsx`:
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

`app-v2/client/src/components/Sidebar.tsx`:
```tsx
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, ListOrdered, CalendarDays } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/particulars", label: "Income & Expenses", icon: ListOrdered },
  { to: "/holidays", label: "Holidays", icon: CalendarDays },
];

export function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between p-4">
        <span className="font-bold">Future Finance</span>
        <ThemeToggle />
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {items.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to}
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

`app-v2/client/src/components/BottomNav.tsx`:
```tsx
import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, ListOrdered, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/particulars", label: "Items", icon: ListOrdered },
  { to: "/holidays", label: "Holidays", icon: CalendarDays },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t bg-background md:hidden">
      {items.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to}
          className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-xs",
            pathname === to ? "text-foreground" : "text-muted-foreground")}>
          <Icon className="h-5 w-5" />{label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Verify it compiles and renders**

Run (from `app-v2/client/`): `npm run dev`
Expected: sidebar visible ≥768px, bottom nav <768px, theme toggle flips light/dark. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add app-v2/client/src/components app-v2/client/components.json
git commit -m "feat(client): port ui primitives, theme provider, app shell"
```

---

### Task 14: Routes + ActiveAccountProvider + Particulars & Holidays screens

**Files:**
- Create: `app-v2/client/src/providers/ActiveAccountProvider.tsx`
- Create: `app-v2/client/src/router.tsx`
- Modify: `app-v2/client/src/App.tsx` (use the router)
- Create: `app-v2/client/src/pages/Particulars.tsx` + `ParticularForm.tsx` + `OverrideManagement.tsx`
- Create: `app-v2/client/src/pages/Holidays.tsx`
- Create: `app-v2/client/src/pages/Login.tsx`

**Interfaces:**
- Consumes: `trpc` hooks; `particularInput`/`holidayInput` schemas from `@lib/schemas`; `Layout`.
- Produces: working `/particulars` (list + create/edit/delete + override management) and `/holidays` (list + create/delete) screens; an `ActiveAccountProvider` exposing the single account via `trpc.account.get`.

- [ ] **Step 1: Implement ActiveAccountProvider**

`app-v2/client/src/providers/ActiveAccountProvider.tsx`:
```tsx
import { createContext, useContext } from "react";
import { trpc } from "@/trpc";

type Account = { id: string; name: string; currentBalance: number; balanceUpdatedAt: Date };
const Ctx = createContext<{ account: Account | null; isLoading: boolean }>({ account: null, isLoading: true });

export function ActiveAccountProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = trpc.account.get.useQuery();
  return <Ctx.Provider value={{ account: data ?? null, isLoading }}>{children}</Ctx.Provider>;
}
export const useActiveAccount = () => useContext(Ctx);
```

- [ ] **Step 2: Implement the router + App**

`app-v2/client/src/router.tsx`:
```tsx
import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { Particulars } from "@/pages/Particulars";
import { Holidays } from "@/pages/Holidays";
import { Login } from "@/pages/Login";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Layout><Dashboard /></Layout>} />
      <Route path="/particulars" element={<Layout><Particulars /></Layout>} />
      <Route path="/holidays" element={<Layout><Holidays /></Layout>} />
    </Routes>
  );
}
```

`app-v2/client/src/App.tsx` (replace placeholder):
```tsx
import { ThemeProvider } from "@/components/theme-provider";
import { ActiveAccountProvider } from "@/providers/ActiveAccountProvider";
import { AppRoutes } from "@/router";

export default function App() {
  return (
    <ThemeProvider>
      <ActiveAccountProvider>
        <AppRoutes />
      </ActiveAccountProvider>
    </ThemeProvider>
  );
}
```

(Remove the `ThemeProvider` wrap from `main.tsx` if added there in Task 13 Step 2 — it now lives in `App.tsx`. Keep only one.)

- [ ] **Step 3: Port Particulars + form + override management**

Port `ParticularForm.tsx` and `OverrideManagement.tsx` from `src/app/_components/`, plus the list page from `src/app/particulars/page.tsx`, into `app-v2/client/src/pages/`. Replace:
- `api` (Next tRPC) → `trpc` from `@/trpc`
- `useActiveAccount` import → `@/providers/ActiveAccountProvider`
- Remove `"use client"` directives
- Form validation uses `particularInput` from `@lib/schemas` via `@hookform/resolvers/zod`
- `create`/`update` no longer pass `accountId` (server derives it from the session) — drop that field from the payload

`app-v2/client/src/pages/Particulars.tsx` (list shell — port the form/override components alongside):
```tsx
import { useState } from "react";
import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { ParticularForm } from "./ParticularForm";

export function Particulars() {
  const { data: particulars, isLoading } = trpc.particular.list.useQuery();
  const [editing, setEditing] = useState<null | { id: string }>(null);
  const [formOpen, setFormOpen] = useState(false);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Income &amp; Expenses</h1>
        <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>Add</Button>
      </div>
      <div className="space-y-2">
        {(particulars ?? []).map((p) => (
          <div key={p.id} className="flex justify-between rounded-md border p-3"
               onClick={() => { setEditing({ id: p.id }); setFormOpen(true); }}>
            <span>{p.name}</span>
            <span className={Number(p.amount) < 0 ? "text-finance-expense" : "text-finance-income"}>
              {formatCurrency(Number(p.amount))}
            </span>
          </div>
        ))}
      </div>
      {formOpen && (
        <ParticularForm
          isOpen={formOpen}
          particularId={editing?.id ?? null}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}
```

> The ported `ParticularForm` keeps the original fields (name, type, amount, frequency, start/end dates, isCritical, isFixed, businessDayAdjustment). On submit it calls `trpc.particular.create` or `trpc.particular.update` and invalidates `trpc.particular.list`. `OverrideManagement` lists `trpc.particular.listOverrides` for a particular and calls `trpc.particular.deleteOverride` to revert.

- [ ] **Step 4: Port Holidays + a minimal Login**

`app-v2/client/src/pages/Holidays.tsx`:
```tsx
import { useState } from "react";
import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";

export function Holidays() {
  const utils = trpc.useUtils();
  const { data: holidays } = trpc.holiday.list.useQuery();
  const create = trpc.holiday.create.useMutation({ onSuccess: () => utils.holiday.list.invalidate() });
  const del = trpc.holiday.delete.useMutation({ onSuccess: () => utils.holiday.list.invalidate() });
  const [name, setName] = useState(""); const [date, setDate] = useState(""); const [recurring, setRecurring] = useState(false);

  return (
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
  );
}
```

`app-v2/client/src/pages/Login.tsx`:
```tsx
export function Login() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <a href="/api/auth/signin"
         className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Sign in</a>
    </div>
  );
}
```

- [ ] **Step 5: Verify compile + commit**

Run (from `app-v2/client/`): `npm run build`
Expected: `tsc -b && vite build` succeeds.

```bash
git add app-v2/client/src
git commit -m "feat(client): routes, active account, particulars and holidays screens"
```

---

### Task 15: Dashboard/forecast screen (runs the engine locally)

**Files:**
- Create: `app-v2/client/src/pages/Dashboard.tsx`
- Create: `app-v2/client/src/pages/dashboard/MetricCard.tsx`, `DailyCard.tsx`, `OverrideModal.tsx`, `DangerNotification.tsx`, `BalanceSparkline.tsx`, `UpdateBalanceModal.tsx`, `SkipTodayButton.tsx`
- Create: `app-v2/client/src/lib/toEngine.ts`
- Test: `app-v2/client/src/lib/toEngine.test.ts`

**Interfaces:**
- Consumes: `trpc.forecast.getData`; `computeForecast` from `@lib/engine`; `useActiveAccount`.
- Produces: `toEngineInputs(data)` mapping the `forecast.getData` response → `{ particulars: EngineParticular[]; holidays: EngineHoliday[]; anchorBalance; anchorDate }`; a Dashboard that computes balances client-side and renders the ported widgets with today→+3-months horizon and load-more.

- [ ] **Step 1: Write the failing test for the client mapper**

`app-v2/client/src/lib/toEngine.test.ts`:
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

Run (from `app-v2/client/`): `npm test -- run src/lib/toEngine.test.ts`
Expected: FAIL — cannot find module `./toEngine`.

- [ ] **Step 3: Implement the client mapper**

`app-v2/client/src/lib/toEngine.ts`:
```ts
import type { EngineParticular, EngineHoliday } from "@lib/engine";

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

Run: `npm test -- run src/lib/toEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the Dashboard + ported widgets**

Port the widgets (`MetricCard`, `DailyCard`, `OverrideModal`, `DangerNotification`, `BalanceSparkline`, `UpdateBalanceModal`, `SkipTodayButton`) from `src/app/_components/` into `app-v2/client/src/pages/dashboard/`, replacing `api`→`trpc`, removing `"use client"`, and importing types from `@lib/engine` (`DailyBalance`, `DailyEvent`). `OverrideModal` calls `trpc.particular.overrideInstance` and invalidates `trpc.forecast.getData`.

`app-v2/client/src/pages/Dashboard.tsx`:
```tsx
import { useMemo, useState } from "react";
import { addMonths, startOfDay } from "date-fns";
import { trpc } from "@/trpc";
import { computeForecast } from "@lib/engine";
import { toEngineInputs } from "@/lib/toEngine";
import { MetricCard } from "./dashboard/MetricCard";
import { DailyCard } from "./dashboard/DailyCard";
import { DangerNotification } from "./dashboard/DangerNotification";
import { SkipTodayButton } from "./dashboard/SkipTodayButton";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/design-system";

export function Dashboard() {
  const today = startOfDay(new Date());
  const [monthsAhead, setMonthsAhead] = useState(3);
  const [skipToday, setSkipToday] = useState(false);
  const viewStart = today;
  const viewEnd = addMonths(today, monthsAhead);

  const { data, isLoading } = trpc.forecast.getData.useQuery({ viewStart, viewEnd });

  const result = useMemo(() => {
    if (!data) return null;
    const inputs = toEngineInputs(data as never);
    return computeForecast({ ...inputs, viewStart, viewEnd, today, skipToday });
  }, [data, monthsAhead, skipToday]);

  if (isLoading || !result) return <p className="text-muted-foreground">Loading…</p>;

  const current = result.days[0]?.openingBalance ?? 0;
  const thisMonth = result.months[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <SkipTodayButton skipToday={skipToday} onToggle={() => setSkipToday((s) => !s)} />
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

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Daily Transactions</h2>
        {result.days.map((day) => <DailyCard key={day.date.toISOString()} day={day} />)}
      </div>

      <div className="flex justify-center">
        <Button variant="outline" size="sm" onClick={() => setMonthsAhead((m) => m + 1)}>Load next month</Button>
      </div>
    </div>
  );
}
```

> Keep `MetricCard`, `DailyCard`, `OverrideModal`, `DangerNotification`, `BalanceSparkline`, `SkipTodayButton`, `UpdateBalanceModal` faithful to the originals (same markup/classes). The only structural change vs. the old app: balances come from `computeForecast` (anchored), and the horizon is today→+N months instead of −30/+14.

- [ ] **Step 6: Verify build + commit**

Run (from `app-v2/client/`): `npm run build`
Expected: build succeeds.

```bash
git add app-v2/client/src/pages app-v2/client/src/lib
git commit -m "feat(client): dashboard forecast screen running the engine locally"
```

---

### Task 16: Root dev orchestration + end-to-end smoke

**Files:**
- Modify: `app-v2/package.json` (add `dev` script running client + server together)
- Create: `app-v2/README.md` (run instructions)

**Interfaces:**
- Produces: `npm run dev` at `app-v2/` boots both the API (3001) and the Vite SPA (5173) with the proxy.

- [ ] **Step 1: Add concurrent dev script**

Add to `app-v2/package.json`:
```json
{
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm --prefix server run dev\" \"npm --prefix client run dev\"",
    "test": "vitest && npm --prefix server test -- run && npm --prefix client test -- run"
  },
  "devDependencies": { "concurrently": "^9.0.0" }
}
```
Run (from `app-v2/`): `npm install`.

- [ ] **Step 2: Provision the database**

Copy `.env.example` → `.env` (in `app-v2/`), set a real `DATABASE_URL` and `AUTH_SECRET` (`openssl rand -base64 32`), then:
Run (from `app-v2/server/`): `npm run db:push`
Expected: schema synced to Postgres.

- [ ] **Step 3: Full-stack smoke test**

Run (from `app-v2/`): `npm run dev`. In the browser at `http://localhost:5173`:
- Dashboard loads (account auto-created on first authenticated request; if unauthenticated, sign in via `/login` → `/api/auth/signin`).
- Add an income and an expense on `/particulars`; confirm they appear on the dashboard daily cards with correct signs.
- Update the balance; confirm projected balances re-anchor.
- Add a future recurring expense large enough to go negative; confirm the danger notification and "Next Negative" metric appear.
- Click "Load next month"; confirm an extra month renders and its opening balance reflects all prior events.
Expected: all behaviors correct.

- [ ] **Step 4: Run the full test suite**

Run (from `app-v2/`): `npm test`
Expected: engine, server, and client unit tests all pass.

- [ ] **Step 5: Commit**

```bash
git add app-v2/package.json app-v2/package-lock.json app-v2/README.md
git commit -m "chore: root dev orchestration and run docs"
```

---

## Self-Review

**Spec coverage:**
- Single-user auth (Auth.js + Prisma adapter, session) → Tasks 7, 9, 11.
- One FinanceAccount per user, growth-shaped (`ownerId @unique`) → Task 7; auto-create on first login → Task 9 (`resolveAccount`).
- Particulars + recurrence + critical/flexible + fixed/adjustable + business-day → Tasks 2–4 (engine), 7 (schema), 10 (router), 14 (UI).
- Holidays (one-time + recurring) → Tasks 3, 7, 10, 14.
- Per-instance overrides (amount/date/skip) keyed by `(particularId, originalDate)`, validation server-side → Tasks 4 (engine), 6/10 (schema + `assertOverrideAllowed`), 15 (override modal).
- Pure engine run on both sides → Tasks 1–5 (engine), 8/15 (mappers both sides), 15 (client runs `computeForecast`).
- Anchored replay fix → Task 5 (explicit test: future window reflects pre-viewStart events) + Task 10 `forecast.getData` window.
- Dashboard widgets (metric cards, danger, lowest, skip today, daily cards) → Task 15.
- Theme port + token consolidation → Task 12 (globals.css verbatim, helpers-only design-system).
- App shell responsive → Task 13.
- Today→+3-months horizon + load-more → Task 15.
- Vitest everywhere, Vite SPA + Express + dev proxy → Tasks 1, 11, 12, 16.
- Zod schemas shared both sides → Task 6, consumed in 10 and 14.

**Placeholder scan:** No "TBD/TODO/handle edge cases" left in steps; every code step shows complete code. The one intentional design TBD (debt) is out of scope and absent from the plan.

**Type consistency:** `EngineParticular`/`EngineHoliday`/`EngineOverride`/`DailyBalance`/`DailyEvent`/`MonthlySummary` defined in Task 2 are used unchanged in Tasks 3–5, 8, 15. `computeForecast`'s `ForecastInput` (Task 5) matches the call site in Task 15. `assertOverrideAllowed` signature (Task 10 test ↔ impl) matches. `resolveAccount(userId)` (Task 9) matches all router call sites (Task 10). `trpc` client type `AppRouter` (Task 10 export) matches the client import (Task 12).

**Known intentional divergences from the old app (not bugs):**
1. DB stores `amount` positive (sign from `type`); old app stored expenses negative. The engine/mappers apply the sign.
2. Forecast horizon today→+3mo (old app: −30/+14).
3. Auth providers list starts empty in `authConfig` — fill in the real provider(s) (OAuth/email) matching the old app's config before production sign-in works; the magic-link/OAuth choice carries over from the spec's "keep NextAuth + provider".

