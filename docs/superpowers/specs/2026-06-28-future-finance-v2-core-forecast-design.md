# Future Finance v2 — Core Forecast Slice (Design)

**Date:** 2026-06-28
**Status:** Approved design, ready for implementation planning
**Author:** Muzzamil Khan (with Claude)

## Purpose

A clean rebuild of Future Finance, starting from scratch. This spec covers the
**first, narrowest shippable slice**: a single-user financial forecaster that projects
future account balance from a manually-maintained current balance, using
recurring/once-off incomes and expenses, holidays, business-day adjustments, and
per-instance overrides.

Later slices (separate spec → plan → implementation cycles) will add multiple
accounts, collaboration, debt-as-account, and a full UX redesign. This spec
deliberately omits all of those.

## Guiding Principles

1. **The engine is pure and central.** The forecast calculation is a standalone,
   side-effect-free library (`lib/engine/`) with no React and no Prisma. It is the
   one piece everything depends on and the one piece tested exhaustively. "Today"
   and "skip today" are passed in as parameters — the engine never reads the clock.
2. **Correct anchoring.** Every projected balance replays from the account's
   `balanceUpdatedAt` (seeded with `currentBalance`) forward to the visible window.
   Future months are never computed from a floating window start. This fixes a real
   bug in the original app, which only replayed a fixed `-30/+14` window.
3. **Faithful UX port.** Reproduce the original UX, made responsive; do not redesign.
   Usability improvements are captured as follow-ups, not built here.

## Scope

### In scope
- Single-user auth (NextAuth v5 + provider + Prisma adapter)
- One `FinanceAccount` per user, structured so multi-account/collab slot in later
  without migrating core tables
- Particulars (income/expense; once-off + weekly/fortnightly/monthly/annual)
- Critical/flexible and fixed/adjustable rules
- Business-day adjustment (next/prev/none) + holidays
- Per-instance overrides (amount / date / skip), keyed by `(particularId, originalDate)`
- A pure, headless forecast engine run on both client and server
- Forecast dashboard: faithful port of the original UX (daily cards, metric cards,
  danger + lowest-balance widgets, Skip Today), made responsive
- Theme ported with token consolidation

### Explicitly deferred (noted, NOT built)
- Multiple accounts (UI selector, account CRUD)
- Collaboration / share links / co-managers
- Debt-as-account
- Full UX redesign: forecast navigation, faster particular entry, clearer override
  indicators, prominent balance anchor, mobile polish pass
- Playwright e2e tests

## Tech Stack

A single **Next.js (App Router)** application. The earlier seed targeted a Vite SPA +
standalone Express server; this design pivots to Next.js at the user's request,
collapsing the client/server split into one app while keeping the pure engine,
data model, schemas, and all business rules unchanged.

- **Framework:** **Next.js 16** (App Router, React Server Components), TypeScript
- **API:** **tRPC 11** mounted via an App Router **fetch route handler** at
  `app/api/trpc/[trpc]/route.ts` (no Express, no dev proxy — UI and API share one origin)
- **Auth:** **NextAuth v5** (`next-auth@5.0.0-beta.31`) with `@auth/prisma-adapter`,
  mounted at `app/api/auth/[...nextauth]/route.ts`; HTTP-only session cookie
- **DB/ORM:** **Prisma 7** + PostgreSQL
- **Client data:** **React Query 5** via `@trpc/react-query`; the dashboard runs the
  engine in the browser for instant recompute
- **Validation:** **Zod 4** schemas in `lib/schemas/`, shared by client forms and server procedures
- **UI:** Tailwind v4, Radix/shadcn UI, lucide-react, recharts, react-hook-form
- **Tests:** Vitest across `lib/engine`, `server`, and component/mapper units
  (Playwright dropped from this slice)

### Version notes
- **NextAuth v5 is beta.** There is no stable v5 release; `5.0.0-beta.31` is the
  standard, widely-used App Router path. v4 is the last stable line but is not
  App-Router-native. We pin the beta deliberately.
- **Prisma 7** and **Zod 4** are current. Zod 4 keeps the `import { z } from "zod"`
  entry point, so schema code is unaffected by the major bump.

## Architecture

One Next.js app + one shared pure library.

```
Next.js app (App Router) — one origin, one process
  app/
    layout.tsx, page.tsx (Dashboard), particulars/, holidays/, login/
    api/trpc/[trpc]/route.ts          tRPC fetch adapter
    api/auth/[...nextauth]/route.ts   NextAuth v5 handler
  server/  — server-only (never imported by client bundles)
    trpc.ts (init, context, protectedProcedure, resolveAccount)
    db.ts (Prisma singleton) · auth.ts (NextAuth config) · mappers.ts
    routers/* (account, particular, holiday, forecast, _app)
        │ Prisma
Postgres: User · FinanceAccount · Particular · ParticularOverride · Holiday
          (+ Auth.js tables)

lib/engine/  — PURE (no React, no DB), imported by BOTH client and server
lib/schemas/ — shared Zod schemas, imported by BOTH client and server
```

### Repo layout (single Next.js app at repo root)
```
/app             Next.js App Router (pages + route handlers)
  api/trpc/[trpc]/route.ts
  api/auth/[...nextauth]/route.ts
/server          tRPC routers, context, Prisma, auth config, mappers (server-only)
/lib/engine      pure engine (vitest) — imported by both sides
/lib/schemas     shared Zod schemas — imported by both sides
/prisma          schema + migrations
/baseline        v1 theme + shadcn components (source for the theme port)
```

### Module boundaries & contracts
- **Client components never touch Prisma.** All data flows via tRPC. Because Next.js
  serves UI and API from one origin, the session cookie works with no proxy or CORS.
- **tRPC types** are shared from `server/` to client components via TypeScript;
  `server/` modules are server-only (guarded so they never enter client bundles).
- **The engine is imported directly by the dashboard client component** for live
  recompute (overrides, skip-today, load-more month) with no round-trip. The server
  can call the same engine later (collab, far-future) with zero duplication.
- Each engine function is **deterministic and side-effect-free**: same inputs, same
  output. This is what makes it unit-testable and runnable on both sides.

## Engine (`lib/engine/`)

Split into focused files:

- **`dates.ts`** — `isBusinessDay`, `adjustToBusinessDay`, `expandRecurringHolidays`.
  Pure date helpers; holidays passed in.
- **`instances.ts`** — `generateInstances(particular, viewStart, viewEnd, holidays)
  → Instance[]`. Recurrence + override + business-day logic (including the UTC
  date-compare used to match overrides to instances).
- **`forecast.ts`** — `computeForecast(input) → { days, months, firstNegative,
  lowest }`. The anchored replay loop, plus derived monthly summaries and
  lowest/first-negative lookups.
- **`types.ts`** — `Instance`, `DailyBalance`, `DailyEvent`, `MonthlySummary`,
  `EngineParticular`, `EngineOverride`, `EngineHoliday`. Plain types, **no Prisma
  imports.** The API layer maps Prisma rows → engine types (`server/mappers.ts`).

### Engine contract

```ts
// lib/engine/types.ts — plain, no Prisma imports
type EngineParticular = {
  id: string; name: string;
  type: 'INCOME' | 'EXPENSE'; amount: number;       // amount always positive
  frequency: 'ONCE_OFF'|'WEEKLY'|'FORTNIGHTLY'|'MONTHLY'|'ANNUAL';
  startDate: Date; endDate: Date | null;
  isCritical: boolean; isFixed: boolean;
  businessDayAdjustment: 'NONE'|'NEXT_BUSINESS_DAY'|'PREVIOUS_BUSINESS_DAY';
  overrides: EngineOverride[];
};
type EngineOverride = {
  id: string; originalDate: Date;
  overriddenDate: Date | null; overriddenAmount: number | null; isSkipped: boolean;
};
type EngineHoliday = { date: Date; isRecurring: boolean };

// lib/engine/instances.ts
function generateInstances(
  p: EngineParticular, viewStart: Date, viewEnd: Date, holidays: EngineHoliday[]
): Instance[];

// lib/engine/forecast.ts — THE anchored replay
function computeForecast(input: {
  anchorBalance: number;   // FinanceAccount.currentBalance
  anchorDate:    Date;     // FinanceAccount.balanceUpdatedAt (start of replay)
  viewStart:     Date;     // first day to DISPLAY
  viewEnd:       Date;     // last day to display
  today:         Date;     // passed in, never read from the clock
  skipToday:     boolean;
  particulars:   EngineParticular[];
  holidays:      EngineHoliday[];
}): {
  days:          DailyBalance[];          // only [viewStart..viewEnd]
  months:        MonthlySummary[];
  firstNegative: DailyBalance | null;
  lowest:        DailyBalance | null;
};
```

**The critical fix, precisely:** `computeForecast` replays **every event from
`anchorDate` through `viewEnd`**, seeding the running balance with `anchorBalance`,
then returns only the slice `[viewStart..viewEnd]` for display. So when month +4 is
loaded, its opening balance reflects every prior event since the last balance update,
not a floating window start.

### Engine business rules (ported behavior)
- **Sign convention:** `amount` stored positive; sign applied from `type` (INCOME
  positive, EXPENSE negative) during replay.
- **Recurrence:** ONCE_OFF emits at most one instance; WEEKLY/FORTNIGHTLY/MONTHLY/
  ANNUAL step via date-fns `addWeeks/addMonths/addYears` from `startDate`, bounded by
  `endDate` (null = indefinite) and the view/replay end.
- **Business-day adjustment:** if an instance lands on a weekend or holiday and
  adjustment is NEXT/PREVIOUS, walk to the nearest business day; flag
  `isMovedDueToHoliday`. NONE = no change.
- **Holidays:** one-time = exact date; recurring = match month + day every year.
- **Overrides** (matched on `(particularId, originalDate)`, UTC date compare):
  - `isSkipped` → instance contributes 0, flagged skipped.
  - `overriddenAmount` → replaces amount (only valid if `!isFixed`).
  - `overriddenDate` → moves the instance (only valid if `!isCritical`).
- **Validation:** amount override requires `!isFixed`; date/skip override requires
  `!isCritical`. Enforced server-side (source of truth) and mirrored client-side.

## Data Model (Prisma)

```prisma
// --- Auth.js tables: User, Account, Session, VerificationToken (standard) ---

model User {
  id      String          @id @default(cuid())
  email   String?         @unique
  name    String?
  // ... standard Auth.js fields ...
  financeAccount FinanceAccount?           // one-per-user FOR NOW
}

model FinanceAccount {
  id               String       @id @default(cuid())
  name             String       @default("My Account")
  currentBalance   Decimal      @db.Decimal(15, 2)
  balanceUpdatedAt DateTime     @default(now())   // forecast anchor
  ownerId          String       @unique           // @unique = one-per-user now
  owner            User         @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  particulars      Particular[]
  holidays         Holiday[]
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
}

model Particular {
  id                    String                @id @default(cuid())
  accountId             String
  name                  String
  type                  ParticularType
  amount                Decimal               @db.Decimal(15,2)   // positive in DB
  frequency             RecurrenceFrequency   @default(ONCE_OFF)
  startDate             DateTime              @db.Date
  endDate               DateTime?             @db.Date            // null = indefinite
  isCritical            Boolean               @default(true)      // false = flexible
  isFixed               Boolean               @default(true)      // false = adjustable
  businessDayAdjustment BusinessDayAdjustment @default(NONE)
  account               FinanceAccount        @relation(fields: [accountId], references: [id], onDelete: Cascade)
  overrides             ParticularOverride[]
  @@index([accountId, startDate, endDate])
}

model ParticularOverride {
  id               String     @id @default(cuid())
  particularId     String
  originalDate     DateTime   @db.Date
  overriddenDate   DateTime?  @db.Date
  overriddenAmount Decimal?   @db.Decimal(15,2)
  isSkipped        Boolean    @default(false)
  particular       Particular @relation(fields: [particularId], references: [id], onDelete: Cascade)
  @@unique([particularId, originalDate])
}

model Holiday {
  id          String         @id @default(cuid())
  accountId   String
  name        String
  date        DateTime       @db.Date
  isRecurring Boolean        @default(false)   // recurring = month+day every year
  account     FinanceAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  @@unique([accountId, date])
}

enum ParticularType        { INCOME EXPENSE }
enum RecurrenceFrequency   { ONCE_OFF WEEKLY FORTNIGHTLY MONTHLY ANNUAL }
enum BusinessDayAdjustment { NONE NEXT_BUSINESS_DAY PREVIOUS_BUSINESS_DAY }
```

**Growth note:** `ownerId @unique` is the only thing enforcing one-account-per-user.
Dropping it + adding `AccountManager`/`AccountShareLink` tables later is an additive
migration; no core-table changes.

## API Surface & Auth

### Auth
- **NextAuth v5** mounted at `app/api/auth/[...nextauth]/route.ts` via its App Router
  handler, with the Prisma adapter and the same provider config intent as the
  original (OAuth/email). HTTP-only session cookie. The shared `auth()` helper
  resolves the session in route handlers, server components, and the tRPC context.
- UI and API share one origin (single Next.js server) → the cookie works with no
  proxy and no CORS.
- **On first authenticated request:** auto-create a `FinanceAccount` for the user
  (`name: "My Account"`, `currentBalance: 0`), via `resolveAccount`.
- The tRPC context resolves the session via `auth()`; `protectedProcedure` rejects
  unauthenticated calls. Shared `resolveAccount(userId)` loads the caller's single
  account (creating it if missing); every procedure scopes to it.

### tRPC routers (`server/routers/`)
```
account
  get()                        -> { id, name, currentBalance, balanceUpdatedAt }
  updateBalance({ balance })   -> sets currentBalance + balanceUpdatedAt = now

particular
  list()                       -> all particulars (+ overrides) for the account
  create(input) / update(input) / delete({ id })
  overrideInstance({ particularId, originalDate, overriddenAmount?, overriddenDate?, isSkipped })
       -> upsert on (particularId, originalDate); enforces rules server-side:
          amount override rejected if isFixed; date/skip rejected if isCritical
  deleteOverride({ id })       -> revert one instance
  listOverrides({ particularId })

holiday
  list() / create(input) / delete({ id })

forecast
  getData({ viewStart, viewEnd })
       -> { account: { currentBalance, balanceUpdatedAt },
            particulars(+overrides), holidays }
       Server fetches the FULL replay window [balanceUpdatedAt .. viewEnd]
       (NOT just [viewStart..viewEnd]), specifically:
         - recurring particulars whose [startDate..endDate] overlaps the window
           (endDate null = indefinite)
         - once-off particulars with startDate in the window
         - overrides with originalDate in the window
         - one-time holidays with date in the window + ALL recurring holidays
       so the client can run the full anchored replay from balanceUpdatedAt.
```

### Calculation flow
- The dashboard (a Client Component) calls `forecast.getData` via tRPC React Query
  hooks, maps Prisma-shaped rows to engine types, and runs `computeForecast` locally
  → instant recompute on override / skip-today / load-more with no round-trip.
- The server fetches the data window anchored at `balanceUpdatedAt` (not just the
  visible window) so the replay is correct.
- Fixed/critical validation enforced server-side in `overrideInstance` (source of
  truth), mirrored client-side in the modal for UX.

### Validation
- Zod schemas in `lib/schemas/`, one per entity, imported by both client forms and
  server procedures.

## UI Port & Theme Consolidation

### Theme / CSS (portable baseline — `baseline/`)
- `globals.css` ported verbatim — OKLCH token system (`:root` + `.dark`),
  finance-semantic colors (income/expense/neutral/warning/stale), radius scale.
  Single source of truth for color/spacing tokens.
- `design-system.ts` **consolidated**: drop values that merely duplicate CSS vars;
  keep only helpers — `formatCurrency` (NZD), `getAmountColorClass`,
  `getAmountBgClass`, `isStale`, `getRelativeTime`, touch-target/contrast constants.
- `baseline/components/ui/*` (shadcn/Radix: button, card, dialog, input, select,
  checkbox, badge, dropdown-menu, label, radio-group, separator, textarea) +
  `components.json` ported as-is. These are already Next.js-native, so they drop in
  unchanged.
- Theme provider: `next-themes` (the baseline's original choice) with the `.dark`
  toggle; `ThemeToggle` ported.

### Screens (faithful port, Next.js App Router)
| Route          | Screen | Notes |
|----------------|--------|-------|
| `/`            | Dashboard/Forecast — metric cards (current/lowest/next-negative/this-month), balance sparkline, danger notification, lowest-balance widget, Skip Today, daily cards | Client Component; runs the engine locally |
| `/particulars` | List + create/edit form (type, amount, recurrence, dates, critical/flexible, fixed/adjustable, business-day) + override management | |
| `/holidays`    | Holiday list + add (name, date, recurring) | |
| `/login`       | NextAuth sign-in | |

### Shell & navigation
- `Layout` + `Sidebar` (desktop ≥768px) + `BottomNav` (mobile) ported — already
  responsive. Navigation uses `next/link` + `usePathname()`.
- Active-account context simplifies to the single account but keeps the provider
  shape so multi-account drops in later.

### Forecast horizon
- Default: today → **+3 months**, with "load next month" (button or infinite scroll)
  appending a month and re-running the anchored replay. Replaces the original
  `-30/+14` window.

### Next.js specifics
- Pages are Server Components by default; the dashboard, forms, and any component
  using tRPC hooks / browser state are Client Components (`"use client"`).
- A Client Component tRPC + React Query provider wraps the app (in the root layout).
- lucide-react icons and recharts (sparkline) carry over unchanged.

## Testing

- **Vitest** across `lib/engine`, `server`, and component/mapper units.
- **Priority:** exhaustive unit coverage of `lib/engine` — recurrence variants,
  business-day adjustment (weekend + holiday, next/prev), recurring-holiday
  expansion, all three override types + validation, and the anchored replay
  (especially that far-future months anchor correctly to `balanceUpdatedAt`).
- Server routers tested with a mocked Prisma client; auth-scoping checks; the
  `assertOverrideAllowed` rule and the mappers tested as pure units.
- Playwright e2e deferred to a follow-up.

## Follow-ups (later spec → plan cycles)
1. Full UX redesign: forecast navigation (month accordion / jump), faster particular
   entry, clearer override/skip indicators + easy revert, prominent balance anchor,
   mobile polish.
2. Multiple accounts (account CRUD + selector UI; drop `ownerId @unique`).
3. Collaboration: `AccountManager` + `AccountShareLink`, invite flow, role-based access.
4. Debt-as-account: model debt as an account that interacts with other accounts
   (details TBD at implementation time).
5. Playwright e2e suite.
</content>
</invoke>
