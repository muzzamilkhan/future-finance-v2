# Future Finance v2 — Core Forecast Slice (Design)

**Date:** 2026-06-28
**Status:** Approved design, ready for implementation planning
**Author:** Muzzamil Khan (with Claude)

## Purpose

A clean rebuild of Future Finance, starting from scratch in a new app folder. This
spec covers the **first, narrowest shippable slice**: a single-user financial
forecaster that projects future account balance from a manually-maintained current
balance, using recurring/once-off incomes and expenses, holidays, business-day
adjustments, and per-instance overrides.

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
   bug in the current app, which only replays a fixed `-30/+14` window.
3. **Faithful UX port.** Reproduce the current UX, made responsive; do not redesign.
   Usability improvements are captured as follow-ups, not built here.

## Scope

### In scope
- Single-user auth (Auth.js + provider + Prisma adapter)
- One `FinanceAccount` per user, structured so multi-account/collab slot in later
  without migrating core tables
- Particulars (income/expense; once-off + weekly/fortnightly/monthly/annual)
- Critical/flexible and fixed/adjustable rules
- Business-day adjustment (next/prev/none) + holidays
- Per-instance overrides (amount / date / skip), keyed by `(particularId, originalDate)`
- A pure, headless forecast engine run on both client and server
- Forecast dashboard: faithful port of today's UX (daily cards, metric cards,
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

Changed from the current Next.js/T3 app at the user's request:

- **Build/client:** Vite + React SPA, React Router for pages
- **API:** standalone **Express** server (Node, `tsx` in dev) hosting tRPC + Prisma + Auth.js
- **Auth transport:** Vite dev proxy routes `/api/*` → API server, so SPA and API are
  same-origin (no CORS); Auth.js HTTP-only session cookie. Prod: one reverse proxy
  fronts both.
- **Tests:** Vitest across all packages (Playwright dropped from this slice)
- **Unchanged from current app:** TypeScript, tRPC 11, React Query, Prisma 6,
  PostgreSQL, Auth.js (NextAuth lineage), Tailwind, Radix/shadcn ui, lucide-react,
  recharts, Zod, react-hook-form

## Architecture

Two deployable pieces + one shared pure library.

```
client/  — Vite React SPA
  React Router (pages) · ui/* + theme · tRPC React client
  imports lib/engine for instant local recompute
        │  /api/trpc  (same-origin via Vite dev proxy)
server/  — Express (Node, tsx in dev)
  Auth.js handler · tRPC middleware · routers · Prisma
  auth guard: every procedure scoped to caller's account
        │ Prisma
Postgres: User · FinanceAccount · Particular · ParticularOverride · Holiday
          (+ Auth.js tables)

lib/engine/  — PURE (no React, no DB), imported by BOTH client and server
```

### Repo layout (single repo, shared lib)
```
/client          Vite SPA      (vite, React Router, vitest)
  vite.config.ts   server.proxy['/api'] -> localhost:3001
/server          Express API   (tsx dev, vitest)
  index.ts, trpc.ts, auth.ts, db.ts, mappers.ts, routers/*
/lib/engine      pure engine   (vitest) — imported by both
/lib/schemas     shared Zod schemas — imported by both
/prisma          schema + migrations
```

### Module boundaries & contracts
- **Client never touches Prisma.** All data flows via tRPC. The dev proxy makes
  `/api` same-origin so the Auth.js session cookie works without CORS.
- **tRPC types** are shared from `server/` to `client/` via TypeScript project
  references, preserving end-to-end type safety.
- **The engine is imported directly by the client** for live recompute (overrides,
  skip-today, load-more month) with no round-trip — matching the original
  "client-side, no caching" intent. The server can call the same engine later
  (collab, far-future) with zero duplication.
- Each engine function is **deterministic and side-effect-free**: same inputs, same
  output. This is what makes it unit-testable and runnable on both sides.

## Engine (`lib/engine/`)

Split into focused files:

- **`dates.ts`** — `isBusinessDay`, `adjustToBusinessDay`, `expandRecurringHolidays`.
  Pure date helpers; holidays passed in.
- **`instances.ts`** — `generateInstances(particular, viewStart, viewEnd, holidays)
  → Instance[]`. Recurrence + override + business-day logic (port of current
  `particular-utils.ts`, cleaned up — including the UTC date-compare used to match
  overrides to instances).
- **`forecast.ts`** — `computeForecast(input) → { days, months, firstNegative,
  lowest }`. The anchored replay loop, plus derived monthly summaries and
  lowest/first-negative lookups (port of current `dashboard-calculator.ts`).
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
  account FinanceAccount?           // one-per-user FOR NOW
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
- Auth.js mounted at `/api/auth/*` via its Express handler, Prisma adapter, same
  provider config as today (OAuth/email). HTTP-only session cookie.
- Vite dev proxy routes `/api/*` → `localhost:3001`; SPA and API same-origin →
  cookie works, no CORS.
- **On first login:** auto-create a `FinanceAccount` for the user (`name: "My
  Account"`, `currentBalance: 0`), mirroring the original "default account on
  creation" requirement.
- tRPC context resolves the session from the cookie; `protectedProcedure` rejects
  unauthenticated calls. Shared `resolveAccount(ctx)` loads the caller's single
  account; every procedure scopes to it.

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
- Client calls `forecast.getData`, maps Prisma-shaped rows to engine types, runs
  `computeForecast` locally → instant recompute on override / skip-today / load-more
  with no round-trip.
- Server fetches the data window anchored at `balanceUpdatedAt` (not just the
  visible window) so the replay is correct.
- Fixed/critical validation enforced server-side in `overrideInstance` (source of
  truth), mirrored client-side in the modal for UX.

### Validation
- Zod schemas in `lib/schemas/`, one per entity, imported by both client forms and
  server procedures.

## UI Port & Theme Consolidation

### Theme / CSS (portable baseline)
- `globals.css` ported verbatim — OKLCH token system (`:root` + `.dark`),
  finance-semantic colors (income/expense/neutral/warning/stale), radius scale.
  Single source of truth for color/spacing tokens.
- `design-system.ts` **consolidated**: drop values that merely duplicate CSS vars;
  keep only helpers — `formatCurrency` (NZD), `getAmountColorClass`,
  `getAmountBgClass`, `isStale`, `getRelativeTime`, touch-target/contrast constants.
- `components/ui/*` (shadcn/Radix: button, card, dialog, input, select, checkbox,
  badge, dropdown-menu, label, radio-group, separator, textarea) + `components.json`
  ported as-is.
- `next-themes` → small Vite-compatible theme provider (same `.dark` toggle +
  localStorage); `ThemeToggle` ported.

### Screens (faithful port, React Router)
| Route          | Screen | Ported from |
|----------------|--------|-------------|
| `/`            | Dashboard/Forecast — metric cards (current/lowest/next-negative/this-month), balance sparkline, danger notification, lowest-balance widget, Skip Today, daily cards | `DashboardClient`, `MetricCard`, `DailyCard`, `DangerNotification`, `LowestBalanceWidget`, `BalanceSparkline`, `SkipTodayButton`, `UpdateBalanceModal` |
| `/particulars` | List + create/edit form (type, amount, recurrence, dates, critical/flexible, fixed/adjustable, business-day) + override management | `ParticularForm`, `OverrideManagement` |
| `/holidays`    | Holiday list + add (name, date, recurring) | `holidays/page` |
| `/login`       | Auth.js sign-in | `login/page` |

### Shell & navigation
- `Layout` + `Sidebar` (desktop ≥768px) + `BottomNav` (mobile) ported as-is —
  already responsive.
- Active-account context simplifies to the single account but keeps the provider
  shape so multi-account drops in later.

### Forecast horizon
- Default: today → **+3 months**, with "load next month" (button or infinite scroll)
  appending a month and re-running the anchored replay. Replaces today's `-30/+14`
  window.

### Routing/data changes from Next
- Server Components → plain SPA components fetching via tRPC hooks
  (`useQuery`/`useMutation`); React Query is the cache layer.
- lucide-react icons and recharts (sparkline) carry over unchanged.

## Testing

- **Vitest** across `lib/engine`, `server`, and `client`.
- **Priority:** exhaustive unit coverage of `lib/engine` — recurrence variants,
  business-day adjustment (weekend + holiday, next/prev), recurring-holiday
  expansion, all three override types + validation, and the anchored replay
  (especially that far-future months anchor correctly to `balanceUpdatedAt`).
- Server routers tested with a test DB or mocked Prisma; auth-scoping checks.
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
