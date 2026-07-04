# User-level holidays + remove account switching — design

**Date:** 2026-07-03
**Status:** Approved

## Summary

Two coupled changes:

1. **Holidays become user-level.** A holiday belongs to a `User`, not a
   `FinanceAccount`. All accounts owned by that user forecast against the same
   holiday set. When a user views a **shared** account (they are a MEMBER), the
   forecast applies the **account owner's** holidays. Sharees see the owner's
   holidays read-only.

2. **Remove account switching entirely.** The account switcher (`AccountPicker`)
   existed primarily so the user could pick which account's holidays to edit.
   With holidays now user-level, no page needs a user-selectable "active
   account". Rip out the switcher UI and the switching machinery.

**Data is wiped** as part of this change (pre-production, seeded only). No
data-preserving migration is required — the migration may reset the database.

## Motivation

Holidays are a property of a person's calendar (public holidays where they live,
personal days off), not of an individual bank account. Modelling them per-account
forced the user to duplicate holiday sets across their accounts and was the only
reason the nav needed an account switcher. Moving holidays to the user removes
both problems.

## Data model changes

### `Holiday` re-keyed to `User`

```prisma
model Holiday {
  id          String        @id @default(cuid())
  userId      String        // was: accountId
  name        String
  date        DateTime      @db.Date
  isRecurring Boolean       @default(false)
  source      HolidaySource @default(CUSTOM)
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, name, source])
}
```

- `User` gains `holidays Holiday[]`.
- `FinanceAccount.holidays` relation is **removed**.

### `canEditHolidays` removed

With holidays user-level, the per-membership `canEditHolidays` permission governs
nothing (members can't edit an account's holidays — those don't exist; only the
owner edits their own user-level holidays). Remove it fully:

- Drop `canEditHolidays` from `AccountMembership` and `ShareInvite`.
- Remove the `editHolidays` capability from `server/permissions.ts`.
- Remove it from `account.ts` and `invite.ts` routers, `SharePanel.tsx`, the
  invite-accept page, and `AccountContext`'s `AccountListItem` type.

### Migration

Pre-production, data-wipe is acceptable. Use a Prisma migration that drops/recreates
the affected tables/columns (`Holiday.accountId` → `userId`, drop the two
`canEditHolidays` columns). Running `prisma migrate reset` (or a migration that does
not attempt to preserve rows) is fine.

## Forecast behaviour

Holidays are date-based global markers used by the engine for business-day shifting.

### `forecast.getData` (single account)

Resolve the account's **owner** (the OWNER membership's `userId`) and load *that
user's* holidays. A sharee viewing a shared account therefore gets the owner's
holidays — matching "sharees see the owner's holidays".

### `forecast.getCombined` (dashboard, all the user's accounts)

Each included account may have a different owner. Load holidays for the **union of
all included accounts' owners** and pass them as the single flat `holidays` array
(the current combined shape). For accounts you own that's your own holidays; for
shared accounts, the owner's. This is the approved union approach — holidays are
not scoped per-account in the combined view.

## Holidays router → user-level

`holiday.*` procedures move from `accountProcedure` to `protectedProcedure`:

- `list` / `create` / `delete` / `import` operate on `ctx.user.id`; no `accountId`
  input, no `assertCan(editHolidays)` — a user always edits their own holidays.
- `availableCountries` / `subdivisions` become `protectedProcedure` (they took an
  `accountId` only to satisfy `accountProcedure`; drop it).
- `import`'s dedupe/replace keys on `userId` instead of `accountId`.

## Remove account switching (UI + machinery)

- **Delete** `app/_components/AccountPicker.tsx`; remove its use from `Sidebar.tsx`
  and `BottomNav.tsx`.
- **Slim `AccountContext`**: expose `accounts`, `defaultAccountId` (derived: the
  `isDefault` account, else the first), and `isLoading`. Remove `setAccountId`,
  `STORAGE_KEY`, localStorage persistence, and the stored-selection branch of
  `pickInitialAccountId`. Rename `accountId` consumers to `defaultAccountId` where a
  target account is still needed.

### Per-page treatment of the former "active account"

- **Holidays page** — no account needed (user-level). Remove `useActiveAccount`,
  the `accountId` inputs on every query/mutation, and the `canEditHolidays` gating.
  The owner (the current user) can always edit, so `canEdit` is always `true`.
- **Particulars page** — still needs a default target account for the *create* row
  and for move-account filtering. Use `defaultAccountId`. No switching UI.
- **Spending page** — uses `accountList`/`getCombined`; just drop the unused
  `useActiveAccount` reference if present.
- **Accounts page** — uses per-row account ids and the default-star toggle, not an
  active account. Drop `accountId`/`setAccountId`; keep `accounts`.

## Testing

- **Engine** unchanged — it already consumes a flat `holidays` array; no engine
  test changes.
- **`holiday` router** (Vitest): user-scoped list/create/delete/import; import
  dedupe/replace keyed on user; two users' holidays are isolated.
- **`forecast` router**: `getData` on a shared account applies the **owner's**
  holidays, not the viewer's; `getCombined` applies the **union** of owners'
  holidays across owned + shared accounts.
- **`AccountContext`**: `defaultAccountId` picks the `isDefault` account, falls back
  to first, is `null` when empty.
- **Permissions/routers**: `canEditHolidays` removed from all payloads and inputs;
  existing account/invite tests updated to drop the field.

## Out of scope

- No change to the engine's holiday semantics (business-day shifting).
- No change to how particulars/overrides/transfers are scoped (still per-account).
- No new sharing semantics beyond "sharees see the owner's holidays".
