# User-level Holidays + Remove Account Switching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move holidays from `FinanceAccount` to `User` (owner's holidays apply to all their accounts; sharees see the owner's), and rip out the now-unnecessary account switcher.

**Architecture:** `Holiday` is re-keyed to `userId`. The holiday router becomes user-scoped (`protectedProcedure`). The forecast router resolves each account's OWNER and loads that user's holidays (`getData` = one owner; `getCombined` = union of owners). The per-membership `canEditHolidays` permission is removed everywhere. The `AccountPicker` UI and switching machinery are deleted; `AccountContext` slims to a read-only `accounts` list + derived `defaultAccountId`.

**Tech Stack:** Next.js 16 (App Router) · React 19 · tRPC 11 · Prisma 7 · PostgreSQL · Vitest · Zod 4 · React Query 5.

## Global Constraints

- Test runner is **Vitest** everywhere. No Playwright.
- Keep `lib/engine/` and `lib/schemas/` free of React/Prisma/Next imports.
- `Particular.amount` positive; sign from `type` inside the engine (unchanged here).
- One commit per completed task.
- Data wipe is acceptable (pre-production). Migrations may reset the DB.
- Dev server is already running on :3000 — do NOT start another. See `dev.log` to debug.
- Currency: NZD via `Intl.NumberFormat('en-NZ', …)` (unchanged here).

---

### Task 1: Re-key `Holiday` to `User` and drop `canEditHolidays` (schema + migration)

**Files:**
- Modify: `prisma/schema.prisma` (models `User`, `FinanceAccount`, `Holiday`, `AccountMembership`, `ShareInvite`)

**Interfaces:**
- Produces: `Holiday.userId` (replaces `Holiday.accountId`); `User.holidays`; removal of `AccountMembership.canEditHolidays` and `ShareInvite.canEditHolidays`; removal of `FinanceAccount.holidays`.

- [ ] **Step 1: Edit `prisma/schema.prisma` — `Holiday` model**

Replace the whole `Holiday` model (currently keyed on `accountId`) with:

```prisma
model Holiday {
  id          String        @id @default(cuid())
  userId      String
  name        String
  date        DateTime      @db.Date
  isRecurring Boolean       @default(false)
  source      HolidaySource @default(CUSTOM)
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, name, source])
}
```

- [ ] **Step 2: Edit `User` model — add the back-relation**

In `model User { … }`, add alongside the other relation fields:

```prisma
  holidays      Holiday[]
```

- [ ] **Step 3: Edit `FinanceAccount` model — remove the holidays relation**

Delete this line from `model FinanceAccount`:

```prisma
  holidays         Holiday[]
```

- [ ] **Step 4: Remove `canEditHolidays` from `AccountMembership` and `ShareInvite`**

Delete this line from BOTH `model AccountMembership` and `model ShareInvite`:

```prisma
  canEditHolidays  Boolean        @default(false)
```

- [ ] **Step 5: Generate the migration (resets data — that is expected)**

Run: `npx prisma migrate dev --name user_level_holidays_drop_can_edit_holidays`
Expected: migration created and applied; Prisma client regenerated. If it prompts about data loss / a non-empty DB, accept the reset (data wipe is approved).

- [ ] **Step 6: Verify Prisma client compiles against the new shape**

Run: `npx tsc --noEmit`
Expected: FAIL — many errors referencing `holiday.accountId`, `canEditHolidays`, and `FinanceAccount.holidays`. This is expected; later tasks fix them. Confirm the errors are ONLY about those three things (not unrelated breakage).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(holidays): re-key Holiday to User, drop canEditHolidays column"
```

---

### Task 2: Make the holiday router user-scoped

**Files:**
- Modify: `server/routers/holiday.ts`

**Interfaces:**
- Consumes: `protectedProcedure` (from `../trpc`), `ctx.user.id`, `ctx.prisma`.
- Produces: `holiday.list/create/delete/import/availableCountries/subdivisions` all as `protectedProcedure`, keyed on `ctx.user.id`, with NO `accountId` input and NO `assertCan`.

- [ ] **Step 1: Rewrite `server/routers/holiday.ts`**

Replace the file contents with:

```ts
import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { holidayInput, importHolidaysInput } from "@/lib/schemas";
import { fetchCountries, subdivisionsForCountry, fetchHolidays, filterHolidays } from "@/lib/holidayImport";

export const holidayRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.holiday.findMany({ where: { userId: ctx.user.id }, orderBy: { date: "asc" } })),

  create: protectedProcedure.input(holidayInput).mutation(async ({ ctx, input }) =>
    ctx.prisma.holiday.create({ data: { ...input, userId: ctx.user.id, source: "CUSTOM" } })),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) =>
    ctx.prisma.holiday.deleteMany({ where: { id: input.id, userId: ctx.user.id } })),

  availableCountries: protectedProcedure.query(() => fetchCountries()),

  subdivisions: protectedProcedure
    .input(z.object({ countryCode: z.string().length(2) }))
    .query(({ input }) => subdivisionsForCountry(input.countryCode, new Date().getFullYear())),

  import: protectedProcedure.input(importHolidaysInput).mutation(async ({ ctx, input }) => {
    const year = new Date().getFullYear();
    const holidays = filterHolidays(await fetchHolidays(input.countryCode, year), input.stateCode);

    // Dedupe by name (the unique key is (userId, name, source)); keep the last occurrence.
    const byName = new Map(holidays.map((h) => [h.name, h]));
    const data = [...byName.values()].map((h) => ({
      userId: ctx.user.id,
      name: h.name,
      date: new Date(h.date),
      isRecurring: true,
      source: "IMPORTED" as const,
    }));

    // Replace: drop all previously imported holidays, then insert the fresh set.
    await ctx.prisma.$transaction([
      ctx.prisma.holiday.deleteMany({ where: { userId: ctx.user.id, source: "IMPORTED" } }),
      ctx.prisma.holiday.createMany({ data }),
    ]);

    return { imported: data.length };
  }),
});
```

- [ ] **Step 2: Verify the router file typechecks**

Run: `npx tsc --noEmit server/routers/holiday.ts` (or full `npx tsc --noEmit` and confirm no remaining errors originate in `holiday.ts`).
Expected: no errors in `server/routers/holiday.ts` (other files still error until later tasks).

- [ ] **Step 3: Commit**

```bash
git add server/routers/holiday.ts
git commit -m "feat(holidays): make holiday router user-scoped"
```

---

### Task 3: Extract and test the forecast holiday-owner loader

This task adds a pure, testable helper for "which owners' holidays apply to a set of accounts", then wires it in. Existing router tests in this repo unit-test pure helpers (they `vi.mock` prisma), so we follow that pattern rather than hitting a DB.

**Files:**
- Modify: `server/routers/forecast.ts`
- Test: `server/routers/forecast.test.ts` (create if absent; else append)

**Interfaces:**
- Consumes: Prisma models `accountMembership` (has `role`, `userId`, `accountId`), `holiday` (`userId`, `date`, `isRecurring`).
- Produces: `ownerUserIds(memberships): string[]` — the distinct `userId`s of the OWNER membership for each account. Used to build the holiday `where: { userId: { in } }` filter.

- [ ] **Step 1: Write the failing test**

Create/append `server/routers/forecast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ownerUserIds } from "./forecast";

describe("ownerUserIds", () => {
  it("returns distinct owner userIds across accounts", () => {
    const rows = [
      { accountId: "a1", userId: "u1", role: "OWNER" as const },
      { accountId: "a1", userId: "u2", role: "MEMBER" as const },
      { accountId: "a2", userId: "u3", role: "OWNER" as const },
      { accountId: "a3", userId: "u1", role: "OWNER" as const }, // u1 owns two accounts
    ];
    expect(ownerUserIds(rows).sort()).toEqual(["u1", "u3"]);
  });

  it("ignores non-owner rows", () => {
    const rows = [{ accountId: "a1", userId: "m", role: "MEMBER" as const }];
    expect(ownerUserIds(rows)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routers/forecast.test.ts`
Expected: FAIL — `ownerUserIds` is not exported / not defined.

- [ ] **Step 3: Add the helper to `server/routers/forecast.ts`**

Add near the top (after imports, alongside `combinedWindowStart`):

```ts
/** Distinct userIds of the OWNER membership across the given membership rows. Pure, testable. */
export function ownerUserIds(
  memberships: { userId: string; role: "OWNER" | "MEMBER" }[],
): string[] {
  return [...new Set(memberships.filter((m) => m.role === "OWNER").map((m) => m.userId))];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routers/forecast.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add server/routers/forecast.ts server/routers/forecast.test.ts
git commit -m "feat(forecast): add ownerUserIds helper for user-level holidays"
```

---

### Task 4: Load holidays by account owner in `forecast.getData`

**Files:**
- Modify: `server/routers/forecast.ts` (the `getData` procedure)

**Interfaces:**
- Consumes: `ownerUserIds` (Task 3), `ctx.account.id`, `ctx.prisma.accountMembership`, `ctx.prisma.holiday`.
- Produces: `getData` returns the SAME shape as before (`{ account, particulars, holidays }`), but `holidays` now come from the account's OWNER user, not the account.

- [ ] **Step 1: Replace the holiday query inside `getData`**

In `getData`, replace the existing `const holidays = await ctx.prisma.holiday.findMany({ where: { accountId: a.id, … } … })` block with:

```ts
      const ownerMemberships = await ctx.prisma.accountMembership.findMany({
        where: { accountId: a.id, role: "OWNER" },
        select: { userId: true, role: true },
      });
      const ownerIds = ownerUserIds(ownerMemberships);

      const holidays = await ctx.prisma.holiday.findMany({
        where: {
          userId: { in: ownerIds },
          OR: [
            { isRecurring: false, date: { gte: windowStart, lte: input.viewEnd } },
            { isRecurring: true },
          ],
        },
        orderBy: { date: "asc" },
      });
```

(`windowStart` and `input.viewEnd` are already in scope in `getData`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `forecast.ts` `getData`. (`getCombined` still uses `accountId` — fixed in Task 5. Other files may still error until later tasks.)

- [ ] **Step 3: Commit**

```bash
git add server/routers/forecast.ts
git commit -m "feat(forecast): getData applies account owner's holidays"
```

---

### Task 5: Load the union of owners' holidays in `forecast.getCombined`

**Files:**
- Modify: `server/routers/forecast.ts` (the `getCombined` procedure)

**Interfaces:**
- Consumes: `ownerUserIds` (Task 3). Note `getCombined` already fetches `memberships` for the current user's accounts, but those are the VIEWER's memberships — we need each account's OWNER. Fetch owner memberships for the included `accountIds`.
- Produces: `getCombined` returns the same shape; `holidays` is the union across all included accounts' owners.

- [ ] **Step 1: Replace the holiday query inside `getCombined`**

In `getCombined`, replace the existing `const holidays = await ctx.prisma.holiday.findMany({ where: { accountId: { in: accountIds }, … } … })` block with:

```ts
      const ownerMemberships = await ctx.prisma.accountMembership.findMany({
        where: { accountId: { in: accountIds }, role: "OWNER" },
        select: { userId: true, role: true },
      });
      const ownerIds = ownerUserIds(ownerMemberships);

      const holidays = await ctx.prisma.holiday.findMany({
        where: {
          userId: { in: ownerIds },
          OR: [
            { isRecurring: false, date: { gte: windowStart, lte: input.viewEnd } },
            { isRecurring: true },
          ],
        },
        orderBy: { date: "asc" },
      });
```

(`accountIds` and `windowStart` are already in scope in `getCombined`.)

- [ ] **Step 2: Typecheck the forecast router**

Run: `npx tsc --noEmit`
Expected: no remaining errors in `server/routers/forecast.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/routers/forecast.ts
git commit -m "feat(forecast): getCombined applies union of owners' holidays"
```

---

### Task 6: Remove `canEditHolidays` from the permission layer

**Files:**
- Modify: `server/permissions.ts`
- Modify: `server/permissions.test.ts`

**Interfaces:**
- Produces: `Capability` no longer includes `"editHolidays"`; `MembershipPerms` no longer has `canEditHolidays`; `FLAG` no longer maps it.

- [ ] **Step 1: Update `server/permissions.ts`**

- In the `Capability` union, remove `"editHolidays"`:
  ```ts
  export type Capability = "editItems" | "editOverrides" | "updateBalance";
  ```
- In `MembershipPerms`, remove the `canEditHolidays: boolean;` field.
- In the `FLAG` map, remove the `editHolidays: "canEditHolidays",` entry.

- [ ] **Step 2: Update `server/permissions.test.ts`**

Remove `canEditHolidays: false,` from the `owner`, `viewer`, and `editor` fixtures (lines ~4–6). If any test asserts on the `editHolidays` capability, delete that assertion.

- [ ] **Step 3: Run the permissions tests**

Run: `npx vitest run server/permissions.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/permissions.ts server/permissions.test.ts
git commit -m "refactor(perms): drop editHolidays capability"
```

---

### Task 7: Remove `canEditHolidays` from account + invite routers

**Files:**
- Modify: `server/routers/account.ts`
- Modify: `server/routers/account.test.ts`
- Modify: `server/routers/invite.ts`
- Modify: `server/routers/invite.test.ts`

**Interfaces:**
- Produces: `mapMembershipToListItem` output no longer has `canEditHolidays`; `updateMemberPerms` input drops it; `members` output drops it; membership `create` data drops it; `permInput`/`permsFromInvite`/invite `create` drop it.

- [ ] **Step 1: `server/routers/account.ts` — remove every `canEditHolidays`**

Remove `canEditHolidays` from:
- `mapMembershipToListItem` param type AND its returned object.
- `create` membership-create `data` (`canEditItems: true, canEditOverrides: true, canUpdateBalance: true` — drop the holidays line).
- `createCredit` membership-create `data` (same).
- `members` query's mapped return object.
- `updateMemberPerms` input `z.object({ … })` AND the `data: { … }` of the update.

- [ ] **Step 2: `server/routers/invite.ts` — remove every `canEditHolidays`**

Remove `canEditHolidays` from:
- `permInput` (`z.boolean().default(false)` line).
- `permsFromInvite` param type AND returned object.
- `create` `shareInvite.create` `data`.

- [ ] **Step 3: Update the router tests**

- `server/routers/account.test.ts`: remove `canEditHolidays: true,` (and any `canEditHolidays` key) from every `mapMembershipToListItem` fixture.
- `server/routers/invite.test.ts`: remove `canEditHolidays: true,` from the fixtures (lines ~9, ~12) and any assertion on it.

- [ ] **Step 4: Run the affected tests**

Run: `npx vitest run server/routers/account.test.ts server/routers/invite.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/account.ts server/routers/account.test.ts server/routers/invite.ts server/routers/invite.test.ts
git commit -m "refactor(sharing): drop canEditHolidays from account + invite routers"
```

---

### Task 8: Remove `canEditHolidays` from sharing UI

**Files:**
- Modify: `app/_components/SharePanel.tsx`
- Modify: `app/invite/[token]/page.tsx`

**Interfaces:**
- Consumes: `account.members` / `account.updateMemberPerms` / `invite.create` / `invite.get` shapes from Task 7 (no `canEditHolidays`).

- [ ] **Step 1: `app/_components/SharePanel.tsx`**

- In `PERM_KEYS`, remove `"canEditHolidays"` from the tuple.
- Remove `canEditHolidays: false,` from every default/initial perms object (the two occurrences at ~line 22 and ~line 32).
- Remove `canEditHolidays: m.canEditHolidays,` (~line 66).
- If there is a human-readable label map for the perm keys, remove the holidays entry there too.

- [ ] **Step 2: `app/invite/[token]/page.tsx`**

- Remove the line rendering the holidays permission:
  ```tsx
  {data!.perms.canEditHolidays && <li>Can edit holidays</li>}
  ```
- In the "View only" fallback condition, remove `&& !data!.perms.canEditHolidays`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `SharePanel.tsx` or `invite/[token]/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add app/_components/SharePanel.tsx app/invite/[token]/page.tsx
git commit -m "refactor(sharing): drop canEditHolidays from share UI"
```

---

### Task 9: Rewrite the Holidays page for user-level holidays

**Files:**
- Modify: `app/holidays/page.tsx`

**Interfaces:**
- Consumes: `holiday.list/create/delete/import/availableCountries/subdivisions` (Task 2) — all with NO `accountId` argument.
- Produces: a page with no `useActiveAccount`, no `accountId`, no `canEditHolidays` gating. `canEditHolidays` becomes constant `true`.

- [ ] **Step 1: Remove the account dependency**

- Delete the import `import { useActiveAccount } from "@/app/_components/AccountContext";`.
- Delete `const { accountId, activeMembership } = useActiveAccount();`.
- Replace `const canEditHolidays = …;` with `const canEditHolidays = true;`.

- [ ] **Step 2: Drop `accountId` from every query/mutation call**

- `holiday.list.useQuery({ accountId: accountId! }, { enabled: !!accountId })` → `holiday.list.useQuery()`.
- `holiday.availableCountries.useQuery({ accountId: accountId! }, { enabled: !!accountId })` → `holiday.availableCountries.useQuery()`.
- `holiday.subdivisions.useQuery({ accountId: accountId!, countryCode: country }, { enabled: !!accountId && country.length === 2 })` → `holiday.subdivisions.useQuery({ countryCode: country }, { enabled: country.length === 2 })`.
- `create.mutate({ accountId: accountId!, name, date: parsed, isRecurring: recurring })` → `create.mutate({ name, date: parsed, isRecurring: recurring })`.
- `del.mutate({ accountId: accountId!, id: pendingDelete.id })` → `del.mutate({ id: pendingDelete.id })`.
- `importHolidays.mutate({ accountId: accountId!, countryCode: country, stateCode: stateCode || undefined })` → `importHolidays.mutate({ countryCode: country, stateCode: stateCode || undefined })`.

- [ ] **Step 3: Fix the optimistic-cache keys**

The `create`/`del` optimistic handlers use `const key = { accountId: vars.accountId };` and `addRow(old, { … accountId: vars.accountId … })`. Since `list` now takes no input, its cache key is `undefined`:

- In both `onMutate`: replace `const key = { accountId: vars.accountId };` with `const key = undefined;` and update the `utils.holiday.list.cancel(key)` / `getData(key)` / `setData(key, …)` calls to pass `undefined` (i.e. `utils.holiday.list.cancel()`, `utils.holiday.list.getData()`, and `utils.holiday.list.setData(undefined, …)`).
- In the `create` optimistic row passed to `addRow`, remove the `accountId: vars.accountId,` field (the `HolidayItem` type below has no `accountId`; if it does, remove it there too).
- Keep `return { prev, key };` and the `onError` restore `utils.holiday.list.setData(ctx.key, ctx.prev)` (with `ctx.key === undefined`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `app/holidays/page.tsx`.

- [ ] **Step 5: Verify in the running app**

The dev server is already on :3000. Load `/holidays`, confirm the page renders, add a custom holiday, delete it, and confirm no console/network errors (holiday calls carry no `accountId`).

- [ ] **Step 6: Commit**

```bash
git add app/holidays/page.tsx
git commit -m "feat(holidays): user-level holidays page, no account selection"
```

---

### Task 10: Slim `AccountContext` and test `defaultAccountId`

**Files:**
- Modify: `app/_components/AccountContext.tsx`
- Modify: `app/_components/accountContext.test.ts`

**Interfaces:**
- Produces: `useActiveAccount()` returns `{ accounts, defaultAccountId, isLoading }`. `AccountListItem` no longer has `canEditHolidays`. `pickDefaultAccountId(accounts)` is exported and pure. `setAccountId`, `STORAGE_KEY`, and localStorage persistence are removed.

- [ ] **Step 1: Write the failing test**

In `app/_components/accountContext.test.ts`, replace/add tests for the new pure helper (remove tests for the old `pickInitialAccountId` stored-selection behaviour):

```ts
import { describe, it, expect } from "vitest";
import { pickDefaultAccountId } from "./AccountContext";

describe("pickDefaultAccountId", () => {
  it("returns the isDefault account", () => {
    expect(pickDefaultAccountId([
      { id: "a", isDefault: false },
      { id: "b", isDefault: true },
    ])).toBe("b");
  });
  it("falls back to the first account when none is default", () => {
    expect(pickDefaultAccountId([
      { id: "a", isDefault: false },
      { id: "b", isDefault: false },
    ])).toBe("a");
  });
  it("returns null when there are no accounts", () => {
    expect(pickDefaultAccountId([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/_components/accountContext.test.ts`
Expected: FAIL — `pickDefaultAccountId` not exported.

- [ ] **Step 3: Rewrite `app/_components/AccountContext.tsx`**

```tsx
"use client";
import { createContext, useContext, useMemo } from "react";
import { trpc } from "@/trpc/client";

export type AccountListItem = {
  id: string; name: string; currentBalance: number; balanceUpdatedAt: Date;
  type: "DEBIT" | "CREDIT"; creditLimit: number | null;
  role: "OWNER" | "MEMBER"; isDefault: boolean;
  canEditItems: boolean; canEditOverrides: boolean; canUpdateBalance: boolean;
};

export function pickDefaultAccountId(accounts: { id: string; isDefault: boolean }[]): string | null {
  const def = accounts.find((a) => a.isDefault);
  if (def) return def.id;
  return accounts[0]?.id ?? null;
}

type Ctx = {
  accounts: AccountListItem[]; defaultAccountId: string | null; isLoading: boolean;
};
const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { data: accounts = [], isLoading } = trpc.account.list.useQuery(undefined, { staleTime: 30_000 });
  const defaultAccountId = useMemo(() => pickDefaultAccountId(accounts), [accounts]);

  return (
    <AccountCtx.Provider value={{ accounts, defaultAccountId, isLoading }}>
      {children}
    </AccountCtx.Provider>
  );
}

export function useActiveAccount() {
  const c = useContext(AccountCtx);
  if (!c) throw new Error("useActiveAccount must be used within AccountProvider");
  return c;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/_components/accountContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/_components/AccountContext.tsx app/_components/accountContext.test.ts
git commit -m "refactor(accounts): slim AccountContext to read-only default account"
```

---

### Task 11: Delete `AccountPicker` and remove it from nav

**Files:**
- Delete: `app/_components/AccountPicker.tsx`
- Modify: `app/_components/Sidebar.tsx`
- Modify: `app/_components/BottomNav.tsx`

**Interfaces:**
- Consumes: nothing new. Removes the only two render sites of `AccountPicker`.

- [ ] **Step 1: Remove from `Sidebar.tsx`**

- Delete the import `import { AccountPicker } from "./AccountPicker";`.
- Delete the line `<div className="px-3 pb-2"><AccountPicker /></div>` (~line 27).

- [ ] **Step 2: Remove from `BottomNav.tsx`**

- Delete the import `import { AccountPicker } from "./AccountPicker";`.
- Delete `<AccountPicker variant="compact" />` (~line 33). If it sat in a fl/grid row of nav items, confirm the remaining items still lay out sensibly.

- [ ] **Step 3: Delete the component file**

Run: `git rm app/_components/AccountPicker.tsx`

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `AccountPicker`.

- [ ] **Step 5: Verify in the running app**

On :3000, confirm the sidebar and bottom nav render with no account switcher and no layout gap.

- [ ] **Step 6: Commit**

```bash
git add app/_components/Sidebar.tsx app/_components/BottomNav.tsx
git commit -m "feat(nav): remove account switcher"
```

---

### Task 12: Update pages that referenced the active account

**Files:**
- Modify: `app/particulars/page.tsx`
- Modify: `app/accounts/page.tsx`
- Modify: `app/spending/page.tsx` (only if it imports `useActiveAccount`)

**Interfaces:**
- Consumes: the slimmed `useActiveAccount()` → `{ accounts, defaultAccountId, isLoading }` (Task 10). No `accountId`, no `setAccountId`.

- [ ] **Step 1: `app/particulars/page.tsx` — use `defaultAccountId`**

- Change `const { accountId, activeMembership } = useActiveAccount();` to `const { accounts: _accounts, defaultAccountId } = useActiveAccount();` — but keep whatever bindings the file actually uses. Concretely: replace the `accountId` binding with `defaultAccountId`, and if `activeMembership` is unused after removing switcher-only logic, drop it.
- Replace every remaining use of `accountId` in this file with `defaultAccountId` (e.g. the `create.mutate({ accountId: … })` default target, the `canMove`/move-filter `.filter((a) => a.id !== accountId)`, and `AccountBadge … orderedIds`). The create row now defaults new particulars to `defaultAccountId`.
- If `activeMembership` was used for a can-edit gate, replace with the corresponding account from `accounts` (find by `defaultAccountId`) or drop the gate if it was switcher-specific. Do not silently remove a real permission check — if one existed, derive it from `accounts.find((a) => a.id === defaultAccountId)`.

- [ ] **Step 2: `app/accounts/page.tsx` — drop `accountId`/`setAccountId`**

- Change `const { accounts, accountId, setAccountId } = useActiveAccount();` to `const { accounts } = useActiveAccount();`.
- Remove any code that read `accountId` or called `setAccountId` (this page acts on per-row `a.id` and the default-star toggle, not an active account).

- [ ] **Step 3: `app/spending/page.tsx`**

- If (and only if) the file imports `useActiveAccount`, remove the import and any `const { … } = useActiveAccount();` line that is now unused. (The page already derives `accountIds` from `accountList`/`getCombined`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean — no remaining references to the removed context fields anywhere.

- [ ] **Step 5: Verify in the running app**

On :3000: load `/particulars` (add a particular — it lands on the default account), `/accounts` (rename/star toggles work), `/spending`, and `/` (dashboard). No console errors.

- [ ] **Step 6: Commit**

```bash
git add app/particulars/page.tsx app/accounts/page.tsx app/spending/page.tsx
git commit -m "refactor(pages): use default account, drop account switching"
```

---

### Task 13: Full typecheck + test sweep + backfill script check

**Files:**
- Modify: `scripts/backfill-memberships.ts` (only if it references `canEditHolidays`)
- Any file still referencing removed symbols.

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 2: Grep for stragglers**

Run: `git grep -n "canEditHolidays\|AccountPicker\|setAccountId\|pickInitialAccountId\|holiday\.accountId\|accountId: accountId"`
Expected: no results in `app/`, `server/`, `lib/`, `scripts/`, `prisma/` source (matches only inside the spec/plan docs are fine). Fix any real code hits — e.g. if `scripts/backfill-memberships.ts` sets `canEditHolidays`, remove that field.

- [ ] **Step 3: Full test run**

Run: `npx vitest run`
Expected: PASS (all suites green).

- [ ] **Step 4: Commit any straggler fixes**

```bash
git add -A
git commit -m "chore: remove remaining canEditHolidays / switcher references"
```

(If nothing changed in Step 2, skip this commit.)

---

## Self-Review Notes

- **Spec coverage:** schema re-key + drop `canEditHolidays` (T1); user-scoped holiday router (T2); `getData` owner holidays (T3–T4); `getCombined` union (T5); permission removal (T6); router removal (T7); UI removal (T8); holidays page (T9); slim context (T10); delete picker (T11); page updates (T12); sweep (T13). All spec sections mapped.
- **Type consistency:** `ownerUserIds` (T3) consumed in T4/T5; `pickDefaultAccountId` + `AccountListItem` (T10) consumed in T12; holiday router no-arg shape (T2) consumed in T9. `AccountListItem` drops `canEditHolidays` in T10, consistent with router payloads in T7.
- **No placeholders:** every code step shows concrete code/commands.
