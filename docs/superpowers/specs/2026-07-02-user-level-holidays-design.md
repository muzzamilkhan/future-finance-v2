# User-Level Holidays + Remove Nav Account Picker — Design

**Date:** 2026-07-02
**Status:** Approved (design)

## Problem

Holidays are the only page that still meaningfully depends on the account
selector (`AccountPicker`): they are owned by a `FinanceAccount`, so switching
accounts changes which holidays you see. Every other page already presents a
combined, cross-account view, and account *management* now lives on a dedicated
`/accounts` page. If holidays stop being account-specific, the picker no longer
needs to live in the navigation.

## Goal

1. Make holidays **user-owned** instead of account-owned. The forecast applies
   the **viewer's** holidays to every account (owned or shared).
2. Remove `AccountPicker` from the nav (Sidebar + BottomNav).

Both together remove the last reason the picker sits in the nav.

## Decisions (settled)

- **Ownership:** holidays belong to the **User**.
- **Shared accounts:** forecasting any account uses the **viewer's own** holiday
  set (holidays follow the person, not the account).
- **Existing data:** **wiped** in the migration — no backfill.
- **Selector removal scope:** remove `<AccountPicker>` from the **nav only**.
  `AccountContext` / `useActiveAccount` **stays** — the `/accounts` page and the
  particulars/override components still depend on it. Ripping out the context is
  a separate, much larger refactor and is explicitly out of scope.
- **Account management functions** (create/close/leave/share/set-default/credit
  limit): already handled by the existing `/accounts` page. No gap.

## Changes

### 1. Schema — `prisma/schema.prisma`

`Holiday`:
- `accountId String` → `userId String`
- relation `account FinanceAccount @relation(...)` → `user User @relation(...)`
- `@@unique([accountId, name, source])` → `@@unique([userId, name, source])`

`FinanceAccount`: remove the `holidays Holiday[]` relation.
`User`: add `holidays Holiday[]`.

**Migration** (new, under `prisma/migrations/`):
```sql
DELETE FROM "Holiday";
-- drop old FK + unique, add userId column, add FK to "User", add new unique.
```
Wiping first avoids any NULL/orphan `userId` problem on the column swap.

### 2. Holiday router — `server/routers/holiday.ts`

- Every procedure: `accountProcedure` → `protectedProcedure`.
- Drop the `accountId` handling and the `assertCan(ctx.membership, ...)` calls —
  a user always owns their own holidays.
- `list` / `create` / `delete` / `import`: filter and write by
  `ctx.user.id` (`userId`) instead of `ctx.account.id` (`accountId`).
- `import`: keep the dedupe-by-name + replace-imported logic, keyed on `userId`.
- `availableCountries` / `subdivisions`: no data scope needed; become
  `protectedProcedure` (drop the now-unused `accountId` input).

### 3. Schemas — `lib/schemas/holiday.ts`

No change. `holidayInput` / `importHolidaysInput` never contained `accountId`
(it was added by `accountProcedure`'s base input). The `{ accountId: string }`
cast in the router simply goes away.

### 4. Forecast router — `server/routers/forecast.ts`

`getData` and `getCombined` both fetch holidays scoped to the viewer:

```ts
const holidays = await ctx.prisma.holiday.findMany({
  where: {
    userId: ctx.user.id,
    OR: [
      { isRecurring: false, date: { gte: windowStart, lte: input.viewEnd } },
      { isRecurring: true },
    ],
  },
  orderBy: { date: "asc" },
});
```

Same query for both procedures — a simplification (no `accountId` / `in` list).
The engine already takes `holidays` as a plain `EngineHoliday[]`, so no engine
change.

### 5. Holidays page — `app/holidays/page.tsx`

- Remove `useActiveAccount` and all `accountId` usage.
- `list` / `create` / `delete` / `import` / `availableCountries` /
  `subdivisions` queries + mutations call with no `accountId`.
- Optimistic-update cache keys drop `accountId` (key becomes `undefined`).
- `canEditHolidays` → always `true` (you own your holidays).

### 6. Nav — `app/_components/Sidebar.tsx`, `app/_components/BottomNav.tsx`

- Remove the `<AccountPicker ... />` usage and its import from both files.
- Leave `AccountPicker.tsx` in the tree (unused by nav). The `/accounts` page
  already provides account management; no functionality is stranded.

## Out of scope

- Removing `AccountContext` / `useActiveAccount` (kept — used by `/accounts` and
  particulars/override components).
- The `/accounts` management page (already built).

## Testing (TDD, Vitest)

- **Holiday router** (`server/routers/holiday.test.ts`, new or updated):
  - `create`/`list` scope to the calling user; two users don't see each other's
    holidays.
  - `import` replace deletes only the calling user's IMPORTED holidays.
  - `delete` only removes the caller's own holiday.
- **Forecast router** (`server/routers/forecast.test.ts`):
  - A user's holidays are applied to their forecast regardless of which account
    the instances fall on (including a shared account).
- **Engine:** unchanged (holidays already a pure param) — existing tests stand.

## Sequence

TDD per repo convention: for each router change write the failing user-scoped
test, watch it fail, implement minimally, watch it pass, commit. Schema +
migration first (regenerate Prisma client), then router, then page, then nav.
