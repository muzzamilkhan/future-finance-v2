# CLAUDE.md — Future Finance v2

Guidance for Claude Code working in this repo.

## What this repo is

Future Finance is a personal cash-flow forecaster: you record recurring/one-off income
and expenses ("particulars") against one or more accounts, and it replays them forward
to show your projected daily/monthly balance, when an account runs dry, and where your
low points are. It is a **single Next.js (App Router) app** at the repo root and is
**fully implemented** — engine, tRPC API, Prisma/Postgres, Google auth, and all pages.

Design specs and plans live in `docs/superpowers/` for reference, and `baseline/` holds
the portable v1 UI/theme source. Neither is the source of truth for current behavior —
the code is.

## Architecture

- **One Next.js app** serves UI and API from one origin — no separate server, no dev
  proxy, no CORS.
- **Pure engine** (`lib/engine/`) — no React, no DB, deterministic. "Today" and
  "skip today" are passed in as params, never read from the clock. Imported by both
  the dashboard client (instant recompute) and the server. This is the testable heart;
  cover it exhaustively with Vitest.
- **Server layer** (`server/`) — tRPC 11 routers + Prisma 7 + NextAuth v5, mounted via
  App Router route handlers (`app/api/trpc/[trpc]`, `app/api/auth/[...nextauth]`).
  Server-only; client components never touch Prisma — all data flows through tRPC.
- **Pure helpers** for testable UI/domain logic live next to their feature as
  `*.ts` + `*.test.ts` (e.g. `app/spending/spendingChartData.ts`, `lib/optimistic.ts`).
  Keep logic out of `.tsx` where it's worth testing.

### Routers (`server/routers/_app.ts`)

`account`, `particular`, `forecast`, `category`, `holiday`, `invite`, `debt`.

### Pages (`app/`)

`/` (dashboard when signed in, else pre-login home) · `/accounts` · `/particulars` ·
`/spending` · `/debts` · `/holidays` · `/login` · `/invite/[token]`.

## The forecast engine (`lib/engine/`)

`computeForecast` is multi-account aware. Given accounts, particulars, holidays, a view
window, `today`, and `skipToday`, it walks one UTC day at a time from the **replay start**
(earliest account anchor, clamped to `viewStart`) through `viewEnd`, then slices for display.

- **Per-account running balance.** Each account seeds to its `anchorBalance` on the exact
  UTC day it activates (its `anchorDate`), *before* that day's opening snapshot. Before its
  anchor an account is **inactive** and contributes nothing. A leg (income/expense/transfer)
  only applies if *its* account is active that day. The app anchors **every account at
  `today`** (the mapper in `lib/toEngine.ts` sets `anchorDate = today` and seeds
  `currentBalance`), so the forecast replays forward from today using today's balances —
  it does **not** replay history from `balanceUpdatedAt`. The engine stays generic; the
  "anchor at today" choice lives entirely in the mapping.
- **Transfers** move money between two accounts of the same owner: the source leg is
  `-amount`, the destination leg is `+amount`, each gated by its own account's activation.
- **Credit accounts** (`type: "CREDIT"`) store a negative outstanding `balance`;
  `availableCredit = creditLimit + balance`. A credit account is "exhausted" when
  `availableCredit < 0`; a debit account when `balance < 0`.
- **Combined line** = Σ debit balances + Σ available credit across active accounts.
- Outputs: `days`, monthly `months`, `firstNegative`, `lowest`/`highest` (on combined),
  `exhaustions` (first exhaustion per account), and `lowestByAccount` (lowest on the
  displayed figure — available credit for CREDIT, cash for DEBIT; earliest day wins ties).

Instance generation (`instances.ts`) expands a particular into dated occurrences over the
window, applies business-day adjustment and holidays, and folds in overrides.

## Key invariants (don't break these)

- **`Particular.amount` is stored positive**; the sign is applied from `type` inside the
  engine (INCOME +, EXPENSE/TRANSFER −). Overridden amounts are also stored/consumed as
  absolute values.
- **The forecast replays from `today` using each account's `currentBalance`.** Every
  account seeds its `currentBalance` at `today` and the engine replays events forward from
  there — it does **not** replay history from `balanceUpdatedAt`. `currentBalance` is the
  balance as of now, so the server only fetches particulars/overrides from `today` onward
  (`forecast.getData`/`getCombined` window at `viewStart`). `balanceUpdatedAt` is still
  recorded on the row but no longer drives the replay start.
- **"Skip today" is remembered per user, and resets at their local midnight.**
  `User.skipTodayDate` (`@db.Date`) stores the user's local calendar date (UTC-midnight)
  they chose to skip; `forecast.setSkipToday` sets/clears it and `forecast.getCombined`
  returns it. The dashboard treats skip as on **only while** the stored date equals the
  user's current local date, so it survives reloads but auto-resets the next day in the
  user's own timezone (no server cron needed).
- **Overrides are matched to instances by `(particularId, originalDate)`** with a UTC
  year/month/day compare (`ParticularOverride` has `@@unique([particularId, originalDate])`).
- **Override rules:** amount override requires `!isFixed`; date/skip requires `!isCritical`.
  Enforced server-side in the particular router (`assertOverrideAllowed`) and mirrored
  client-side.
- **Engine/schema layers stay pure:** keep `lib/engine/` and `lib/schemas/` free of React,
  Prisma, and Next imports.
- Currency is **AUD** via `Intl.NumberFormat('en-AU', …)` (`formatCurrency` in
  `lib/design-system.ts` is the single source). Dates use `date-fns`; stored date columns
  are `@db.Date` and compared in UTC. Older plans under `docs/superpowers/` and
  `baseline/` still say NZD — they're historical, not current behavior.
- **The local timezone is AEST/AEDT (`Australia/Sydney`).** Every date sits at UTC
  midnight and the engine compares in UTC, so all
  date arithmetic must be UTC-based. date-fns' `add*`/`isSameDay` helpers work in *local*
  time: across the October DST switch they shift a UTC-midnight date to 23:00 the previous
  UTC day, silently moving e.g. a fortnightly item onto the wrong weekday. Use the
  `addUtcDays`/`addUtcMonths`/`addUtcYears` helpers in `lib/engine/dates.ts` instead.

## Accounts, membership & sharing (multi-account model)

There is **no longer one account per user.** Ownership and access run through
`AccountMembership`:

- A user reaches an account only via an `AccountMembership` row (`@@unique([userId, accountId])`).
  On first authenticated use, `ensureBootstrapAccount` creates a fresh `FinanceAccount` +
  an `OWNER` membership (marked `isDefault`) if the user has no open account.
- **Capabilities** gate mutations: `canEditItems`, `canEditOverrides`, `canUpdateBalance`.
  `OWNER` implicitly has all three (`server/permissions.ts` → `hasCapability` / `assertCan`).
- `accountProcedure` takes an `accountId`, resolves the caller's membership
  (`resolveMembership`), and rejects with `FORBIDDEN` (no membership) or `NOT_FOUND`
  (account closed). Account-scoped mutations assert the relevant capability.
- **Sharing:** an owner mints a `ShareInvite` (token + preset capabilities); accepting it
  creates a membership. `forecast.getCombined` and the dashboard aggregate all of a user's
  open-account memberships into one combined line.
- Accounts are **closed** (`closedAt`), not hard-deleted; closing reassigns the user's
  default to another open account (`pickNextDefault`).
- **Categories** are a normalized comma-string on `FinanceAccount.categories`, kept in sync
  from expense particulars (`server/categorySync.ts`); `parseCategories`/`serializeCategories`
  handle dedupe + title-case.
- **Holidays** are **user-level** (`Holiday` on `User`, imported via Nager or custom). In
  the forecast they apply via the account's **owner(s)** holidays.
- **Debts** (`Debt` on `User`) power the standalone Debt Buster payoff simulator
  (`lib/engine/debt.ts`: snowball/avalanche/custom). This is a separate planning tool — it
  is **not** modeled as a `FinanceAccount` and does not feed the cash-flow forecast.

## Stack

Next.js 16 (App Router) · React 19 · Vitest 4 · tRPC 11 · Prisma 7 · PostgreSQL ·
NextAuth v5 (`5.0.0-beta.31`, Google provider, database sessions) · Tailwind v4 ·
Radix/shadcn UI · Zod 4 · React Query 5 · Recharts · date-fns · Sonner · next-themes.
NextAuth v5 is beta by design (no stable v5 exists).

## Working style (hobby project — keep it simple and quick)

- **Work directly on `main`.** Never create a branch or worktree; optimize for speed.
- **Keep tests lean — pure-function tests only.** Cover `lib/engine/` and the co-located
  `*.test.ts` helpers; skip integration/UI test scaffolding. Vitest everywhere; no Playwright.
- **Don't run scripts to verify** unless asked — make the fix and say it's done. localhost
  is usually running, so I'll test manually.
- **Commit when a unit of work is done.** Stage only the files you changed; leave unrelated
  uncommitted work alone.
