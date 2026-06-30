# Multi-Account & Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user own and switch between multiple finance accounts (with default + soft-close), and share an account with another user via a single-use link carrying fine-grained permissions.

**Architecture:** Replace the one-account-per-user model (`FinanceAccount.ownerId @unique` + `resolveAccount`) with an `AccountMembership` join table carrying per-resource permission booleans. Every tRPC request takes an explicit `accountId`; a shared `accountProcedure` middleware resolves the membership and enforces access. Phase 1 lands multi-account; Phase 2 adds `ShareInvite` on top. Testable logic lives in pure helpers (mock-prisma unit-test convention), the forecast engine is untouched.

**Tech Stack:** Next.js 16 (App Router), React 19, tRPC 11, Prisma 7 + PostgreSQL, NextAuth v5, Zod 4, React Query 5, Vitest. DB schema is applied with `prisma db push` (no migration files); data backfill is a runnable script.

## Global Constraints

- Test runner is **Vitest** everywhere. Router tests are **unit tests with a mocked prisma** (`vi.mock("../db")`, `vi.mock("../auth")`) — never a real DB. Pull non-trivial logic into pure functions and test those.
- Keep `lib/engine/` and `lib/schemas/` free of React/Prisma/Next imports.
- `Particular.amount` stored positive; sign applied in engine. Forecast always replays from `balanceUpdatedAt`.
- Overrides matched by `(particularId, originalDate)` with UTC y/m/d compare.
- Override data rules: amount override requires `!isFixed`; date/skip requires `!isCritical`. `assertOverrideAllowed` stays as-is (data rule, orthogonal to access).
- Currency NZD. Commit one commit per completed task.
- Schema changes applied via `npm run db:push`. Prisma client regenerated via `npm run db:generate` after every schema edit.
- `OWNER` role short-circuits all permission checks to allowed; boolean perm flags are authoritative only for `MEMBER`.
- Exactly one `isDefault: true` membership per user; a closed account (`closedAt != null`) cannot be default and is hidden from listings.

---

# Phase 1 — Multi-Account

## Task 1: Schema — AccountMembership, FinanceAccount/User changes

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: models `AccountMembership` (fields: `id, userId, accountId, role, isDefault, canEditItems, canEditOverrides, canEditHolidays, canUpdateBalance, createdAt, updatedAt`), enum `MembershipRole { OWNER MEMBER }`; `FinanceAccount` gains `categories String`, `closedAt DateTime?`, `memberships AccountMembership[]` and loses `ownerId`/`owner`; `User` gains `memberships AccountMembership[]` and loses `categories`/`financeAccount`.

- [ ] **Step 1: Edit schema.prisma**

Replace the `User`, `FinanceAccount` models and add the new model + enum:

```prisma
model User {
  id            String          @id @default(cuid())
  name          String?
  email         String?         @unique
  emailVerified DateTime?
  image         String?
  accounts      Account[]
  sessions      Session[]
  memberships   AccountMembership[]
}

model FinanceAccount {
  id               String   @id @default(cuid())
  name             String   @default("My Account")
  currentBalance   Decimal  @default(0) @db.Decimal(15, 2)
  balanceUpdatedAt DateTime @default(now())
  categories       String   @default("")
  closedAt         DateTime?
  particulars      Particular[]
  holidays         Holiday[]
  memberships      AccountMembership[]
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model AccountMembership {
  id               String   @id @default(cuid())
  userId           String
  accountId        String
  role             MembershipRole @default(MEMBER)
  isDefault        Boolean  @default(false)
  canEditItems     Boolean  @default(false)
  canEditOverrides Boolean  @default(false)
  canEditHolidays  Boolean  @default(false)
  canUpdateBalance Boolean  @default(false)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  user             User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  account          FinanceAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  @@unique([userId, accountId])
  @@index([accountId])
}

enum MembershipRole {
  OWNER
  MEMBER
}
```

- [ ] **Step 2: Push schema and regenerate client**

Run: `npm run db:push && npm run db:generate`
Expected: "Your database is now in sync with your Prisma schema." then client generated. (If `db push` warns about dropping `ownerId`/`categories` columns with data, accept — Task 2 backfill is run separately against any real data; dev DB is reseedable.)

- [ ] **Step 3: Typecheck (expect failures, that's fine)**

Run: `npm run typecheck`
Expected: FAIL — references to `ownerId`, `resolveAccount`, `User.categories` no longer compile. These are fixed in Tasks 3–8. Do not fix here.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add AccountMembership, move categories to account, soft-close"
```

---

## Task 2: Data backfill script

**Files:**
- Create: `scripts/backfill-memberships.ts`

**Interfaces:**
- Produces: a standalone script that, for any `FinanceAccount` row that had an `ownerId` and lacks an OWNER membership, creates one (all perms true, `isDefault` true) and copies the legacy `categories`. Idempotent.

Note: because `db push` already dropped `ownerId`/`User.categories`, this script is for environments where the columns still exist (run BEFORE pushing in production). For the seeded dev DB with no real users, it is a no-op safety net. It reads legacy columns via raw SQL so it compiles against the new client.

- [ ] **Step 1: Write the script**

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Read legacy data via raw SQL (columns may not exist post-push; guarded).
  let legacy: { id: string; ownerId: string; categories: string }[] = [];
  try {
    legacy = await prisma.$queryRawUnsafe(
      `SELECT fa.id, fa."ownerId", u.categories
       FROM "FinanceAccount" fa JOIN "User" u ON u.id = fa."ownerId"`,
    );
  } catch {
    console.log("Legacy columns absent — nothing to backfill.");
    return;
  }
  for (const row of legacy) {
    const existing = await prisma.accountMembership.findUnique({
      where: { userId_accountId: { userId: row.ownerId, accountId: row.id } },
    });
    if (existing) continue;
    await prisma.accountMembership.create({
      data: {
        userId: row.ownerId, accountId: row.id, role: "OWNER", isDefault: true,
        canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      },
    });
    await prisma.financeAccount.update({
      where: { id: row.id }, data: { categories: row.categories ?? "" },
    });
    console.log(`Backfilled membership for account ${row.id}`);
  }
}
main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run it against dev DB**

Run: `npx tsx scripts/backfill-memberships.ts`
Expected: prints "Legacy columns absent — nothing to backfill." on a freshly-pushed dev DB (columns already dropped). No error.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-memberships.ts
git commit -m "chore: idempotent membership/categories backfill script"
```

---

## Task 3: Permission gate + role helpers (pure)

**Files:**
- Create: `server/permissions.ts`
- Test: `server/permissions.test.ts`

**Interfaces:**
- Produces:
  - `type Capability = "editItems" | "editOverrides" | "editHolidays" | "updateBalance"`
  - `type MembershipPerms = { role: "OWNER" | "MEMBER"; canEditItems: boolean; canEditOverrides: boolean; canEditHolidays: boolean; canUpdateBalance: boolean }`
  - `hasCapability(m: MembershipPerms, cap: Capability): boolean` — OWNER always true; else reads the matching flag.
  - `assertCan(m: MembershipPerms, cap: Capability): void` — throws `TRPCError({ code: "FORBIDDEN" })` when `!hasCapability`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hasCapability, assertCan } from "./permissions";

const owner = { role: "OWNER", canEditItems: false, canEditOverrides: false, canEditHolidays: false, canUpdateBalance: false } as const;
const viewer = { role: "MEMBER", canEditItems: false, canEditOverrides: false, canEditHolidays: false, canUpdateBalance: false } as const;
const editor = { role: "MEMBER", canEditItems: true, canEditOverrides: false, canEditHolidays: false, canUpdateBalance: false } as const;

describe("hasCapability", () => {
  it("owner has every capability regardless of flags", () => {
    expect(hasCapability(owner, "editItems")).toBe(true);
    expect(hasCapability(owner, "updateBalance")).toBe(true);
  });
  it("member follows its flags", () => {
    expect(hasCapability(editor, "editItems")).toBe(true);
    expect(hasCapability(editor, "editOverrides")).toBe(false);
    expect(hasCapability(viewer, "editItems")).toBe(false);
  });
});

describe("assertCan", () => {
  it("throws FORBIDDEN when capability missing", () => {
    expect(() => assertCan(viewer, "editItems")).toThrow(/FORBIDDEN|forbidden/i);
  });
  it("does not throw when allowed", () => {
    expect(() => assertCan(editor, "editItems")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/permissions.test.ts`
Expected: FAIL — "Cannot find module './permissions'".

- [ ] **Step 3: Write minimal implementation**

```ts
import { TRPCError } from "@trpc/server";

export type Capability = "editItems" | "editOverrides" | "editHolidays" | "updateBalance";
export type MembershipPerms = {
  role: "OWNER" | "MEMBER";
  canEditItems: boolean; canEditOverrides: boolean; canEditHolidays: boolean; canUpdateBalance: boolean;
};

const FLAG: Record<Capability, keyof MembershipPerms> = {
  editItems: "canEditItems", editOverrides: "canEditOverrides",
  editHolidays: "canEditHolidays", updateBalance: "canUpdateBalance",
};

export function hasCapability(m: MembershipPerms, cap: Capability): boolean {
  if (m.role === "OWNER") return true;
  return m[FLAG[cap]] === true;
}

export function assertCan(m: MembershipPerms, cap: Capability): void {
  if (!hasCapability(m, cap)) throw new TRPCError({ code: "FORBIDDEN" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/permissions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/permissions.ts server/permissions.test.ts
git commit -m "feat(server): permission gate helpers with owner short-circuit"
```

---

## Task 4: Default-account invariant helper (pure)

**Files:**
- Create: `server/defaultAccount.ts`
- Test: `server/defaultAccount.test.ts`

**Interfaces:**
- Produces: `pickNextDefault(memberships: { accountId: string; isDefault: boolean; closedAt: Date | null }[], closingAccountId: string): string | null` — given memberships and the account being closed, returns the accountId that should become default (first non-closed, non-closing account ordered as given), or `null` if none remain. Used by `account.close`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pickNextDefault } from "./defaultAccount";

describe("pickNextDefault", () => {
  const m = (accountId: string, isDefault = false, closedAt: Date | null = null) => ({ accountId, isDefault, closedAt });
  it("returns the first other open account when closing the default", () => {
    expect(pickNextDefault([m("a", true), m("b"), m("c")], "a")).toBe("b");
  });
  it("skips closed accounts", () => {
    expect(pickNextDefault([m("a", true), m("b", false, new Date()), m("c")], "a")).toBe("c");
  });
  it("returns null when no other open account remains", () => {
    expect(pickNextDefault([m("a", true), m("b", false, new Date())], "a")).toBeNull();
  });
  it("returns null when closing the only account", () => {
    expect(pickNextDefault([m("a", true)], "a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/defaultAccount.test.ts`
Expected: FAIL — "Cannot find module './defaultAccount'".

- [ ] **Step 3: Write minimal implementation**

```ts
export function pickNextDefault(
  memberships: { accountId: string; isDefault: boolean; closedAt: Date | null }[],
  closingAccountId: string,
): string | null {
  const candidate = memberships.find(
    (m) => m.accountId !== closingAccountId && m.closedAt == null,
  );
  return candidate ? candidate.accountId : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/defaultAccount.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/defaultAccount.ts server/defaultAccount.test.ts
git commit -m "feat(server): pickNextDefault helper for close-reassignment"
```

---

## Task 5: accountProcedure middleware + resolveMembership/ensureBootstrapAccount

**Files:**
- Modify: `server/trpc.ts`
- Test: `server/trpc.test.ts` (replace the obsolete `resolveAccount` test)

**Interfaces:**
- Consumes: `MembershipPerms` from Task 3.
- Produces:
  - `resolveMembership(userId: string, accountId: string): Promise<{ account: FinanceAccount; membership: AccountMembership }>` — throws `NOT_FOUND` if no row or account closed; throws `FORBIDDEN` if membership absent.
  - `ensureBootstrapAccount(userId: string): Promise<{ account: FinanceAccount; membership: AccountMembership }>` — if user has zero memberships, creates an account + OWNER membership (all perms, `isDefault: true`) and returns it; else returns the user's default (or first) membership+account.
  - `accountProcedure` — `protectedProcedure.input(z.object({ accountId: z.string() }))` with middleware that calls `resolveMembership` and injects `ctx.account`, `ctx.membership`.

- [ ] **Step 1: Replace the trpc.test.ts test (failing)**

```ts
import { describe, it, expect, vi } from "vitest";

const account = { id: "acc1", name: "A", currentBalance: 0, closedAt: null };
const membership = { id: "m1", userId: "u1", accountId: "acc1", role: "OWNER" };

vi.mock("./db", () => ({
  prisma: {
    accountMembership: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.userId_accountId.accountId === "acc1" && where.userId_accountId.userId === "u1"
          ? { ...membership, account } : null),
      count: vi.fn(async () => 1),
    },
  },
}));
vi.mock("./auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { resolveMembership } from "./trpc";

describe("resolveMembership", () => {
  it("returns account + membership for a member", async () => {
    const r = await resolveMembership("u1", "acc1");
    expect(r.account.id).toBe("acc1");
    expect(r.membership.role).toBe("OWNER");
  });
  it("throws FORBIDDEN for a non-member", async () => {
    await expect(resolveMembership("u1", "other")).rejects.toThrow(/FORBIDDEN/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/trpc.test.ts`
Expected: FAIL — `resolveMembership` not exported / old `resolveAccount` removed.

- [ ] **Step 3: Implement in trpc.ts**

Remove `resolveAccount`. Add (keep existing `router`, `publicProcedure`, `protectedProcedure`, `createContext`):

```ts
import { z } from "zod";

export async function resolveMembership(userId: string, accountId: string) {
  const membership = await prisma.accountMembership.findUnique({
    where: { userId_accountId: { userId, accountId } },
    include: { account: true },
  });
  if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
  if (membership.account.closedAt) throw new TRPCError({ code: "NOT_FOUND" });
  const { account, ...rest } = membership;
  return { account, membership: rest };
}

export async function ensureBootstrapAccount(userId: string) {
  const count = await prisma.accountMembership.count({ where: { userId } });
  if (count === 0) {
    const account = await prisma.financeAccount.create({ data: { name: "My Account" } });
    const membership = await prisma.accountMembership.create({
      data: {
        userId, accountId: account.id, role: "OWNER", isDefault: true,
        canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      },
    });
    return { account, membership };
  }
  const m = await prisma.accountMembership.findFirst({
    where: { userId, account: { closedAt: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { account: true },
  });
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "No open accounts" });
  const { account, ...rest } = m;
  return { account, membership: rest };
}

export const accountProcedure = protectedProcedure
  .input(z.object({ accountId: z.string() }))
  .use(async ({ ctx, input, next }) => {
    const { account, membership } = await resolveMembership(ctx.user.id, (input as { accountId: string }).accountId);
    return next({ ctx: { ...ctx, account, membership } });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/trpc.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/trpc.ts server/trpc.test.ts
git commit -m "feat(server): accountProcedure, resolveMembership, ensureBootstrapAccount"
```

---

## Task 6: categorySync per-account + category router accountId

**Files:**
- Modify: `server/categorySync.ts`
- Modify: `server/routers/category.ts`
- Test: `server/categorySync.test.ts` (update existing)

**Interfaces:**
- Consumes: `accountProcedure` (Task 5).
- Produces: `syncAccountCategories(prisma, accountId): Promise<void>` (renamed from `syncUserCategories`, drops `userId`, writes `FinanceAccount.categories`). `computeUserCategories` is unchanged (keep name). `category.list` becomes an `accountProcedure` reading `ctx.account.categories`.

- [ ] **Step 1: Update the failing test**

Read `server/categorySync.test.ts`. Keep the `computeUserCategories` tests. Replace any `syncUserCategories` test with:

```ts
import { describe, it, expect, vi } from "vitest";
import { syncAccountCategories, computeUserCategories } from "./categorySync";

describe("syncAccountCategories", () => {
  it("writes serialized expense categories to the account", async () => {
    const update = vi.fn();
    const prisma = {
      particular: { findMany: vi.fn().mockResolvedValue([{ category: "Food" }, { category: "Rent" }, { category: null }]) },
      financeAccount: { update },
    } as any;
    await syncAccountCategories(prisma, "acc1");
    expect(prisma.particular.findMany).toHaveBeenCalledWith({
      where: { accountId: "acc1", type: "EXPENSE" }, select: { category: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "acc1" }, data: { categories: computeUserCategories(["Food", "Rent", null]) },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/categorySync.test.ts`
Expected: FAIL — `syncAccountCategories` not exported.

- [ ] **Step 3: Implement**

In `server/categorySync.ts`, replace `syncUserCategories`:

```ts
export async function syncAccountCategories(prisma: PrismaClient, accountId: string): Promise<void> {
  const expenses = await prisma.particular.findMany({
    where: { accountId, type: "EXPENSE" }, select: { category: true },
  });
  const categories = computeUserCategories(expenses.map((e) => e.category));
  await prisma.financeAccount.update({ where: { id: accountId }, data: { categories } });
}
```

In `server/routers/category.ts`:

```ts
import { router, accountProcedure } from "../trpc";
import { parseCategories } from "@/lib/budget/category";

export const categoryRouter = router({
  list: accountProcedure.query(({ ctx }) => parseCategories(ctx.account.categories ?? "")),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/categorySync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/categorySync.ts server/routers/category.ts server/categorySync.test.ts
git commit -m "feat(server): per-account category sync and listing"
```

---

## Task 7: Migrate particular / holiday / forecast routers to accountProcedure

**Files:**
- Modify: `server/routers/particular.ts`
- Modify: `server/routers/holiday.ts`
- Modify: `server/routers/forecast.ts`
- Test: `server/routers/particular.test.ts` (unchanged — still tests `assertOverrideAllowed`; verify it passes)

**Interfaces:**
- Consumes: `accountProcedure`, `assertCan` (Task 3), `syncAccountCategories` (Task 6).
- Produces: all these routers' procedures now take `accountId` and use `ctx.account`/`ctx.membership`. Mutations call `assertCan(ctx.membership, ...)`.

- [ ] **Step 1: Rewrite particular.ts procedures**

Change every `protectedProcedure` to `accountProcedure`, replace `const a = await resolveAccount(ctx.user.id)` with `const a = ctx.account`, and add capability gates. The `list` query stays read-only (any member). For each mutation, the input object is merged with `accountId` automatically by `accountProcedure` — extend existing input schemas with `.and(z.object({ accountId: z.string() }))` is NOT needed because `accountProcedure` already injects `accountId`; instead chain `.input(particularInput)` AFTER `accountProcedure` so both merge. Pattern:

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, accountProcedure } from "../trpc";
import { assertCan } from "../permissions";
import { particularInput, overrideInstanceInput } from "@/lib/schemas";
import { syncAccountCategories } from "../categorySync";

// assertOverrideAllowed unchanged — keep exactly as in current file.

export const particularRouter = router({
  list: accountProcedure.query(({ ctx }) =>
    ctx.prisma.particular.findMany({
      where: { accountId: ctx.account.id }, include: { overrides: true }, orderBy: { startDate: "asc" },
    })),

  create: accountProcedure.input(particularInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editItems");
    const created = await ctx.prisma.particular.create({
      data: { ...input, category: input.category ?? null, accountId: ctx.account.id },
    });
    await syncAccountCategories(ctx.prisma, ctx.account.id);
    return created;
  }),

  update: accountProcedure.input(particularInput.and(z.object({ id: z.string() })))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.membership, "editItems");
      const { id, ...data } = input;
      const owned = await ctx.prisma.particular.findFirst({ where: { id, accountId: ctx.account.id } });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const updated = await ctx.prisma.particular.update({
        where: { id }, data: { ...data, category: data.category ?? null },
      });
      await syncAccountCategories(ctx.prisma, ctx.account.id);
      return updated;
    }),
  // ... repeat the same transformation (accountProcedure + ctx.account.id + assertCan)
  //     for the remaining procedures (delete -> editItems; override/skip -> editOverrides),
  //     preserving each procedure's existing body and the assertOverrideAllowed call.
});
```

Note: `accountProcedure` injects `accountId` into input. When you also `.input(particularInput)`, tRPC intersects the two — `accountId` is stripped from `input` is NOT automatic; `input` will still contain `accountId`. When spreading `...input` into Prisma `data`, explicitly destructure it out: `const { accountId: _a, ...rest } = input;` and use `rest`. Apply this wherever `...input` is spread into `data`.

- [ ] **Step 2: Rewrite holiday.ts**

```ts
import { z } from "zod";
import { router, accountProcedure } from "../trpc";
import { assertCan } from "../permissions";
import { holidayInput } from "@/lib/schemas";

export const holidayRouter = router({
  list: accountProcedure.query(({ ctx }) =>
    ctx.prisma.holiday.findMany({ where: { accountId: ctx.account.id }, orderBy: { date: "asc" } })),
  create: accountProcedure.input(holidayInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    const { accountId: _a, ...rest } = input as typeof input & { accountId: string };
    return ctx.prisma.holiday.create({ data: { ...rest, accountId: ctx.account.id } });
  }),
  delete: accountProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    return ctx.prisma.holiday.deleteMany({ where: { id: input.id, accountId: ctx.account.id } });
  }),
});
```

- [ ] **Step 3: Rewrite forecast.ts**

Change `getData` to `accountProcedure`, add its own inputs alongside `accountId`:

```ts
import { z } from "zod";
import { router, accountProcedure } from "../trpc";

export const forecastRouter = router({
  getData: accountProcedure
    .input(z.object({ viewStart: z.coerce.date(), viewEnd: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const a = ctx.account;
      const windowStart = a.balanceUpdatedAt < input.viewStart ? a.balanceUpdatedAt : input.viewStart;
      // ... rest of the existing query body unchanged, using a.id / a.currentBalance / a.balanceUpdatedAt.
    }),
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/routers/particular.test.ts`
Expected: PASS (3 `assertOverrideAllowed` tests — logic unchanged).

Run: `npm run typecheck`
Expected: PASS for these three routers (account router still references old `resolveAccount` until Task 8 — typecheck may still fail there; that's acceptable, Task 8 fixes it).

- [ ] **Step 5: Commit**

```bash
git add server/routers/particular.ts server/routers/holiday.ts server/routers/forecast.ts
git commit -m "feat(server): gate particular/holiday/forecast routers by membership"
```

---

## Task 8: accountRouter — list/create/setDefault/close/leave

**Files:**
- Modify: `server/routers/account.ts`
- Create: `lib/schemas/account.ts` additions (reuse existing file)
- Test: `server/routers/account.test.ts`

**Interfaces:**
- Consumes: `protectedProcedure`, `accountProcedure`, `ensureBootstrapAccount`, `pickNextDefault` (Task 4).
- Produces `accountRouter`:
  - `list` (`protectedProcedure`) → `{ id, name, currentBalance, balanceUpdatedAt, role, isDefault, canEditItems, canEditOverrides, canEditHolidays, canUpdateBalance }[]` for non-closed accounts; calls `ensureBootstrapAccount` first so a brand-new user always has ≥1.
  - `create` (`protectedProcedure.input({ name })`) → creates account + OWNER membership; first-ever becomes default.
  - `setDefault` (`accountProcedure`) → flips default.
  - `close` (`accountProcedure`) → owner-only soft-close + reassign default via `pickNextDefault`.
  - `leave` (`accountProcedure`) → member-only delete own membership.
  - `updateBalance` (`accountProcedure`) → gated by `updateBalance` capability (moved from old router).

- [ ] **Step 1: Write failing tests (pure-ish, mock prisma)**

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { mapMembershipToListItem } from "./account";

describe("mapMembershipToListItem", () => {
  it("flattens membership + account into a list row", () => {
    const row = mapMembershipToListItem({
      role: "OWNER", isDefault: true,
      canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      account: { id: "a", name: "A", currentBalance: 12.5, balanceUpdatedAt: new Date(0) },
    } as any);
    expect(row).toMatchObject({ id: "a", name: "A", currentBalance: 12.5, role: "OWNER", isDefault: true, canEditItems: true });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run server/routers/account.test.ts`
Expected: FAIL — `mapMembershipToListItem` not exported.

- [ ] **Step 3: Implement account.ts**

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, accountProcedure, ensureBootstrapAccount } from "../trpc";
import { assertCan } from "../permissions";
import { pickNextDefault } from "../defaultAccount";
import { updateBalanceInput } from "@/lib/schemas";

export function mapMembershipToListItem(m: {
  role: "OWNER" | "MEMBER"; isDefault: boolean;
  canEditItems: boolean; canEditOverrides: boolean; canEditHolidays: boolean; canUpdateBalance: boolean;
  account: { id: string; name: string; currentBalance: unknown; balanceUpdatedAt: Date };
}) {
  return {
    id: m.account.id, name: m.account.name,
    currentBalance: Number(m.account.currentBalance), balanceUpdatedAt: m.account.balanceUpdatedAt,
    role: m.role, isDefault: m.isDefault,
    canEditItems: m.canEditItems, canEditOverrides: m.canEditOverrides,
    canEditHolidays: m.canEditHolidays, canUpdateBalance: m.canUpdateBalance,
  };
}

export const accountRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await ensureBootstrapAccount(ctx.user.id);
    const memberships = await ctx.prisma.accountMembership.findMany({
      where: { userId: ctx.user.id, account: { closedAt: null } },
      include: { account: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return memberships.map(mapMembershipToListItem);
  }),

  create: protectedProcedure.input(z.object({ name: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const count = await ctx.prisma.accountMembership.count({ where: { userId: ctx.user.id } });
      const account = await ctx.prisma.financeAccount.create({ data: { name: input.name } });
      await ctx.prisma.accountMembership.create({
        data: {
          userId: ctx.user.id, accountId: account.id, role: "OWNER", isDefault: count === 0,
          canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
        },
      });
      return { id: account.id };
    }),

  setDefault: accountProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.$transaction([
      ctx.prisma.accountMembership.updateMany({ where: { userId: ctx.user.id, isDefault: true }, data: { isDefault: false } }),
      ctx.prisma.accountMembership.update({ where: { userId_accountId: { userId: ctx.user.id, accountId: ctx.account.id } }, data: { isDefault: true } }),
    ]);
    return { ok: true };
  }),

  close: accountProcedure.mutation(async ({ ctx }) => {
    if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can close an account" });
    const memberships = await ctx.prisma.accountMembership.findMany({
      where: { userId: ctx.user.id }, include: { account: { select: { closedAt: true } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    const nextDefaultId = pickNextDefault(
      memberships.map((m) => ({ accountId: m.accountId, isDefault: m.isDefault, closedAt: m.account.closedAt })),
      ctx.account.id,
    );
    await ctx.prisma.$transaction(async (tx) => {
      await tx.financeAccount.update({ where: { id: ctx.account.id }, data: { closedAt: new Date() } });
      if (ctx.membership.isDefault && nextDefaultId) {
        await tx.accountMembership.update({
          where: { userId_accountId: { userId: ctx.user.id, accountId: nextDefaultId } }, data: { isDefault: true },
        });
      }
    });
    return { ok: true };
  }),

  leave: accountProcedure.mutation(async ({ ctx }) => {
    if (ctx.membership.role === "OWNER") throw new TRPCError({ code: "BAD_REQUEST", message: "Owner cannot leave; close the account instead" });
    await ctx.prisma.accountMembership.delete({
      where: { userId_accountId: { userId: ctx.user.id, accountId: ctx.account.id } },
    });
    return { ok: true };
  }),

  updateBalance: accountProcedure.input(updateBalanceInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "updateBalance");
    return ctx.prisma.financeAccount.update({
      where: { id: ctx.account.id }, data: { currentBalance: input.balance, balanceUpdatedAt: new Date() },
    });
  }),
});
```

- [ ] **Step 4: Run to verify pass + typecheck**

Run: `npx vitest run server/routers/account.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS (all server routers now compile).

- [ ] **Step 5: Commit**

```bash
git add server/routers/account.ts server/routers/account.test.ts
git commit -m "feat(server): account router list/create/setDefault/close/leave/updateBalance"
```

---

## Task 9: AccountContext (client) + thread accountId through queries

**Files:**
- Create: `app/_components/AccountContext.tsx`
- Modify: `app/providers.tsx`
- Modify: `app/page.tsx`, `app/particulars/page.tsx`, `app/holidays/page.tsx`, `app/budget/page.tsx`
- Test: `app/_components/accountContext.test.ts` (pure selector test)

**Interfaces:**
- Produces:
  - `pickInitialAccountId(accounts: { id: string; isDefault: boolean }[], stored: string | null): string | null` — pure: returns `stored` if it's in `accounts`, else the default account's id, else first id, else null.
  - `AccountProvider` + `useActiveAccount(): { accountId: string | null; setAccountId(id: string): void; accounts: AccountListItem[]; activeMembership: AccountListItem | null; isLoading: boolean }`.

- [ ] **Step 1: Failing test for the pure selector**

```ts
import { describe, it, expect } from "vitest";
import { pickInitialAccountId } from "./AccountContext";

describe("pickInitialAccountId", () => {
  const accts = [{ id: "a", isDefault: false }, { id: "b", isDefault: true }];
  it("uses stored id when still present", () => expect(pickInitialAccountId(accts, "a")).toBe("a"));
  it("falls back to default when stored is gone", () => expect(pickInitialAccountId(accts, "zzz")).toBe("b"));
  it("falls back to first when no default", () =>
    expect(pickInitialAccountId([{ id: "a", isDefault: false }], null)).toBe("a"));
  it("null when empty", () => expect(pickInitialAccountId([], null)).toBeNull());
});
```

Note: the test file is `accountContext.test.ts` but imports from `./AccountContext`; ensure `pickInitialAccountId` is exported from `AccountContext.tsx` (no JSX in that exported fn, so it's importable in node env).

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run app/_components/accountContext.test.ts`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Implement AccountContext.tsx**

```tsx
"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { trpc } from "@/trpc/client";

export type AccountListItem = {
  id: string; name: string; currentBalance: number; balanceUpdatedAt: Date;
  role: "OWNER" | "MEMBER"; isDefault: boolean;
  canEditItems: boolean; canEditOverrides: boolean; canEditHolidays: boolean; canUpdateBalance: boolean;
};

const STORAGE_KEY = "ff.activeAccountId";

export function pickInitialAccountId(accounts: { id: string; isDefault: boolean }[], stored: string | null): string | null {
  if (stored && accounts.some((a) => a.id === stored)) return stored;
  const def = accounts.find((a) => a.isDefault);
  if (def) return def.id;
  return accounts[0]?.id ?? null;
}

type Ctx = {
  accountId: string | null; setAccountId: (id: string) => void;
  accounts: AccountListItem[]; activeMembership: AccountListItem | null; isLoading: boolean;
};
const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { data: accounts = [], isLoading } = trpc.account.list.useQuery(undefined, { staleTime: 30_000 });
  const [accountId, setAccountIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!accounts.length) return;
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    setAccountIdState((cur) => pickInitialAccountId(accounts, cur ?? stored));
  }, [accounts]);

  const setAccountId = (id: string) => {
    setAccountIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  };

  const activeMembership = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);

  return (
    <AccountCtx.Provider value={{ accountId, setAccountId, accounts, activeMembership, isLoading }}>
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

- [ ] **Step 4: Wire provider in providers.tsx**

Wrap children with `<AccountProvider>` INSIDE the `trpc.Provider`/`QueryClientProvider` (it uses `trpc.account.list`). Add import.

```tsx
import { AccountProvider } from "@/app/_components/AccountContext";
// ...
<QueryClientProvider client={queryClient}>
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <AccountProvider>{children}</AccountProvider>
  </ThemeProvider>
</QueryClientProvider>
```

- [ ] **Step 5: Thread accountId into every query/mutation**

In `app/page.tsx`, `app/particulars/page.tsx`, `app/holidays/page.tsx`, `app/budget/page.tsx`: import `useActiveAccount`, read `const { accountId } = useActiveAccount();`, pass `accountId!` into every tRPC input, and gate queries with `{ enabled: !!accountId }`. Examples for page.tsx:

```tsx
const { accountId } = useActiveAccount();
const { data, isLoading } = trpc.forecast.getData.useQuery(
  { accountId: accountId!, viewStart, viewEnd },
  { placeholderData: keepPreviousData, enabled: !!accountId },
);
const { data: particulars } = trpc.particular.list.useQuery(
  { accountId: accountId! }, { enabled: !!accountId });
const updateBalance = trpc.account.updateBalance.useMutation({ /* onSuccess unchanged */ });
// when calling: updateBalance.mutate({ accountId: accountId!, balance });
```

Apply the same to particular create/update/delete/override, holiday create/delete/list, category.list, forecast in budget page. For mutations, add `accountId: accountId!` to the `.mutate(...)` payloads.

- [ ] **Step 6: Run tests + typecheck + build**

Run: `npx vitest run app/_components/accountContext.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/_components/AccountContext.tsx app/providers.tsx app/page.tsx app/particulars/page.tsx app/holidays/page.tsx app/budget/page.tsx app/_components/accountContext.test.ts
git commit -m "feat(client): AccountContext + thread accountId through all tRPC calls"
```

---

## Task 10: Account picker UI in sidebar + permission-aware affordances

**Files:**
- Create: `app/_components/AccountPicker.tsx`
- Modify: `app/_components/Sidebar.tsx`
- Modify: `app/_components/BottomNav.tsx` (mobile: show picker in header area if present) — only if it currently renders a header; otherwise skip
- Modify: pages with edit buttons to disable per perms: `app/particulars/page.tsx` (add/edit/delete), `app/holidays/page.tsx` (add/delete), `app/page.tsx` (update balance, override)

**Interfaces:**
- Consumes: `useActiveAccount` (Task 9).
- Produces: `<AccountPicker />` dropdown — lists accounts (name + default badge + role badge), switch on click, **+ New account** (prompts name → `account.create` → invalidate `account.list` → switch to new id), and per-account menu actions Set default / Close / Leave wired to the respective mutations with `account.list` invalidation.

- [ ] **Step 1: Implement AccountPicker.tsx**

Use existing `dropdown-menu` UI primitives. Minimal version:

```tsx
"use client";
import { useActiveAccount } from "./AccountContext";
import { trpc } from "@/trpc/client";
import { Button } from "./ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { Badge } from "./ui/badge";
import { ChevronsUpDown, Plus, Star, LogOut, Archive } from "lucide-react";

export function AccountPicker() {
  const { accounts, accountId, setAccountId, activeMembership } = useActiveAccount();
  const utils = trpc.useUtils();
  const invalidate = () => utils.account.list.invalidate();
  const create = trpc.account.create.useMutation({ onSuccess: (r) => { invalidate(); setAccountId(r.id); } });
  const setDefault = trpc.account.setDefault.useMutation({ onSuccess: invalidate });
  const close = trpc.account.close.useMutation({ onSuccess: invalidate });
  const leave = trpc.account.leave.useMutation({ onSuccess: invalidate });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between">
          <span className="truncate">{activeMembership?.name ?? "Select account"}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        {accounts.map((a) => (
          <DropdownMenuItem key={a.id} onClick={() => setAccountId(a.id)}>
            <span className="truncate">{a.name}</span>
            {a.isDefault && <Star className="ml-auto h-3 w-3" />}
            {a.role === "MEMBER" && <Badge variant="secondary" className="ml-2">shared</Badge>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => {
          const name = window.prompt("New account name", "New Account");
          if (name) create.mutate({ name });
        }}><Plus className="mr-2 h-4 w-4" />New account</DropdownMenuItem>
        {accountId && activeMembership && !activeMembership.isDefault && (
          <DropdownMenuItem onClick={() => setDefault.mutate({ accountId })}>
            <Star className="mr-2 h-4 w-4" />Set as default</DropdownMenuItem>
        )}
        {accountId && activeMembership?.role === "OWNER" && (
          <DropdownMenuItem onClick={() => { if (confirm("Close this account?")) close.mutate({ accountId }); }}>
            <Archive className="mr-2 h-4 w-4" />Close account</DropdownMenuItem>
        )}
        {accountId && activeMembership?.role === "MEMBER" && (
          <DropdownMenuItem onClick={() => { if (confirm("Leave this account?")) leave.mutate({ accountId }); }}>
            <LogOut className="mr-2 h-4 w-4" />Leave account</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Mount in Sidebar.tsx**

Add `<AccountPicker />` below the "Future Finance" title block:

```tsx
import { AccountPicker } from "./AccountPicker";
// inside <aside>, after the title div:
<div className="px-3 pb-2"><AccountPicker /></div>
```

- [ ] **Step 3: Permission-aware affordances**

In `app/particulars/page.tsx`: read `const { activeMembership } = useActiveAccount();` and disable add/edit/delete controls when `activeMembership && activeMembership.role === "MEMBER" && !activeMembership.canEditItems`. In `app/holidays/page.tsx`: same with `canEditHolidays`. In `app/page.tsx`: disable the update-balance control when `!canUpdateBalance` (member) and override actions when `!canEditOverrides` (member). Owners always enabled. Use the existing Button `disabled` prop; do not remove the controls (keep layout stable).

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npm run typecheck`
Expected: PASS.
Manual: start a dev server on a free port (`npx next dev -p 3210`), sign in, confirm picker shows your account, create a second account, switch, confirm data isolation, set default, close. (Per memory: do NOT rely on :3000 / dev.log here.)

- [ ] **Step 5: Commit**

```bash
git add app/_components/AccountPicker.tsx app/_components/Sidebar.tsx app/particulars/page.tsx app/holidays/page.tsx app/page.tsx
git commit -m "feat(client): account picker + permission-aware controls"
```

---

# Phase 2 — Collaboration

## Task 11: Schema — ShareInvite

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: model `ShareInvite` (fields per design: `id, token @unique, accountId, createdByUserId, role, canEditItems, canEditOverrides, canEditHolidays, canUpdateBalance, acceptedAt, expiresAt, createdAt`); `FinanceAccount` gains `invites ShareInvite[]`.

- [ ] **Step 1: Add to schema.prisma**

```prisma
model ShareInvite {
  id               String   @id @default(cuid())
  token            String   @unique
  accountId        String
  createdByUserId  String
  role             MembershipRole @default(MEMBER)
  canEditItems     Boolean  @default(false)
  canEditOverrides Boolean  @default(false)
  canEditHolidays  Boolean  @default(false)
  canUpdateBalance Boolean  @default(false)
  acceptedAt       DateTime?
  expiresAt        DateTime?
  createdAt        DateTime @default(now())
  account          FinanceAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  @@index([accountId])
}
```

Add `invites ShareInvite[]` to `FinanceAccount`.

- [ ] **Step 2: Push + generate**

Run: `npm run db:push && npm run db:generate`
Expected: in sync; client generated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): ShareInvite for single-use account sharing"
```

---

## Task 12: Invite validation helpers (pure)

**Files:**
- Create: `server/invites.ts`
- Test: `server/invites.test.ts`

**Interfaces:**
- Produces:
  - `inviteState(invite: { acceptedAt: Date | null; expiresAt: Date | null }, now: Date): "valid" | "used" | "expired"`.
  - `assertInviteUsable(invite, now): void` — throws `TRPCError BAD_REQUEST` with message "used"/"expired" when not valid.
  - `generateToken(): string` — 32-byte base64url random (uses `node:crypto`).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { inviteState, assertInviteUsable, generateToken } from "./invites";

const now = new Date("2026-06-30T00:00:00Z");
describe("inviteState", () => {
  it("valid when unused and unexpired", () =>
    expect(inviteState({ acceptedAt: null, expiresAt: null }, now)).toBe("valid"));
  it("used when acceptedAt set", () =>
    expect(inviteState({ acceptedAt: now, expiresAt: null }, now)).toBe("used"));
  it("expired when past expiresAt", () =>
    expect(inviteState({ acceptedAt: null, expiresAt: new Date("2026-06-29T00:00:00Z") }, now)).toBe("expired"));
});
describe("assertInviteUsable", () => {
  it("throws on used", () => expect(() => assertInviteUsable({ acceptedAt: now, expiresAt: null }, now)).toThrow(/used/i));
  it("throws on expired", () => expect(() => assertInviteUsable({ acceptedAt: null, expiresAt: new Date(0) }, now)).toThrow(/expired/i));
  it("passes on valid", () => expect(() => assertInviteUsable({ acceptedAt: null, expiresAt: null }, now)).not.toThrow());
});
describe("generateToken", () => {
  it("produces a long url-safe string", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run server/invites.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";

export function inviteState(
  invite: { acceptedAt: Date | null; expiresAt: Date | null }, now: Date,
): "valid" | "used" | "expired" {
  if (invite.acceptedAt) return "used";
  if (invite.expiresAt && invite.expiresAt.getTime() < now.getTime()) return "expired";
  return "valid";
}

export function assertInviteUsable(invite: { acceptedAt: Date | null; expiresAt: Date | null }, now: Date): void {
  const s = inviteState(invite, now);
  if (s === "used") throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has already been used" });
  if (s === "expired") throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has expired" });
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run server/invites.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/invites.ts server/invites.test.ts
git commit -m "feat(server): invite validation + token helpers"
```

---

## Task 13: inviteRouter + member-management on accountRouter

**Files:**
- Create: `server/routers/invite.ts`
- Modify: `server/routers/account.ts` (add `members`, `updateMemberPerms`, `removeMember`)
- Modify: `server/routers/_app.ts` (mount `invite`)
- Test: `server/routers/invite.test.ts`

**Interfaces:**
- Consumes: `accountProcedure`, `protectedProcedure`, `assertInviteUsable`, `generateToken`, `inviteState`.
- Produces `inviteRouter`:
  - `create` (`accountProcedure`, owner-only) input `{ role?, canEditItems, canEditOverrides, canEditHolidays, canUpdateBalance, expiresAt? }` → `{ token, url }`.
  - `get` (`protectedProcedure.input({ token })`) → `{ accountName, sharedByName, role, perms }` without consuming; throws if not valid.
  - `accept` (`protectedProcedure.input({ token })`) → consumes + creates membership (idempotent); returns `{ accountId }`.
- Produces on `accountRouter`: `members` (owner-only list), `updateMemberPerms` (owner-only), `removeMember` (owner-only).
- Produces pure helper `permsFromInvite(invite)` in `invite.ts` for testing the membership-data mapping.

- [ ] **Step 1: Failing test (pure mapping + state)**

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
import { permsFromInvite } from "./invite";

describe("permsFromInvite", () => {
  it("copies role + perm flags from invite to membership data", () => {
    const data = permsFromInvite({
      role: "MEMBER", canEditItems: true, canEditOverrides: false, canEditHolidays: true, canUpdateBalance: false,
    } as any);
    expect(data).toEqual({
      role: "MEMBER", canEditItems: true, canEditOverrides: false, canEditHolidays: true, canUpdateBalance: false,
    });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run server/routers/invite.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement invite.ts**

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, accountProcedure } from "../trpc";
import { assertInviteUsable, generateToken, inviteState } from "../invites";

const permInput = z.object({
  role: z.enum(["MEMBER"]).default("MEMBER"),
  canEditItems: z.boolean().default(false),
  canEditOverrides: z.boolean().default(false),
  canEditHolidays: z.boolean().default(false),
  canUpdateBalance: z.boolean().default(false),
  expiresAt: z.coerce.date().optional(),
});

export function permsFromInvite(i: {
  role: "OWNER" | "MEMBER"; canEditItems: boolean; canEditOverrides: boolean; canEditHolidays: boolean; canUpdateBalance: boolean;
}) {
  return {
    role: i.role, canEditItems: i.canEditItems, canEditOverrides: i.canEditOverrides,
    canEditHolidays: i.canEditHolidays, canUpdateBalance: i.canUpdateBalance,
  };
}

export const inviteRouter = router({
  create: accountProcedure.input(permInput).mutation(async ({ ctx, input }) => {
    if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can share" });
    const token = generateToken();
    await ctx.prisma.shareInvite.create({
      data: {
        token, accountId: ctx.account.id, createdByUserId: ctx.user.id,
        role: "MEMBER", canEditItems: input.canEditItems, canEditOverrides: input.canEditOverrides,
        canEditHolidays: input.canEditHolidays, canUpdateBalance: input.canUpdateBalance, expiresAt: input.expiresAt,
      },
    });
    return { token, url: `/invite/${token}` };
  }),

  get: protectedProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const invite = await ctx.prisma.shareInvite.findUnique({
      where: { token: input.token }, include: { account: true },
    });
    if (!invite) throw new TRPCError({ code: "NOT_FOUND" });
    assertInviteUsable(invite, new Date());
    const sharer = await ctx.prisma.user.findUnique({ where: { id: invite.createdByUserId }, select: { name: true, email: true } });
    return {
      accountName: invite.account.name,
      sharedByName: sharer?.name ?? sharer?.email ?? "Someone",
      perms: permsFromInvite(invite),
    };
  }),

  accept: protectedProcedure.input(z.object({ token: z.string() })).mutation(async ({ ctx, input }) => {
    const invite = await ctx.prisma.shareInvite.findUnique({ where: { token: input.token } });
    if (!invite) throw new TRPCError({ code: "NOT_FOUND" });
    assertInviteUsable(invite, new Date());
    await ctx.prisma.$transaction(async (tx) => {
      const existing = await tx.accountMembership.findUnique({
        where: { userId_accountId: { userId: ctx.user.id, accountId: invite.accountId } },
      });
      if (!existing) {
        await tx.accountMembership.create({
          data: { userId: ctx.user.id, accountId: invite.accountId, ...permsFromInvite(invite) },
        });
      }
      await tx.shareInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    });
    return { accountId: invite.accountId };
  }),
});
```

- [ ] **Step 4: Add member management to account.ts**

```ts
import { z } from "zod"; // already imported

// inside accountRouter object, add:
members: accountProcedure.query(async ({ ctx }) => {
  if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN" });
  const ms = await ctx.prisma.accountMembership.findMany({
    where: { accountId: ctx.account.id }, include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ms.map((m) => ({
    userId: m.userId, name: m.user.name, email: m.user.email, role: m.role,
    canEditItems: m.canEditItems, canEditOverrides: m.canEditOverrides,
    canEditHolidays: m.canEditHolidays, canUpdateBalance: m.canUpdateBalance,
  }));
}),

updateMemberPerms: accountProcedure.input(z.object({
  userId: z.string(),
  canEditItems: z.boolean(), canEditOverrides: z.boolean(),
  canEditHolidays: z.boolean(), canUpdateBalance: z.boolean(),
})).mutation(async ({ ctx, input }) => {
  if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN" });
  if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change owner perms" });
  await ctx.prisma.accountMembership.update({
    where: { userId_accountId: { userId: input.userId, accountId: ctx.account.id } },
    data: { canEditItems: input.canEditItems, canEditOverrides: input.canEditOverrides,
            canEditHolidays: input.canEditHolidays, canUpdateBalance: input.canUpdateBalance },
  });
  return { ok: true };
}),

removeMember: accountProcedure.input(z.object({ userId: z.string() })).mutation(async ({ ctx, input }) => {
  if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN" });
  if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Owner cannot remove self" });
  await ctx.prisma.accountMembership.delete({
    where: { userId_accountId: { userId: input.userId, accountId: ctx.account.id } },
  });
  return { ok: true };
}),
```

- [ ] **Step 5: Mount invite router in _app.ts**

```ts
import { inviteRouter } from "./invite";
// add to appRouter: invite: inviteRouter,
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run server/routers/invite.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routers/invite.ts server/routers/account.ts server/routers/_app.ts server/routers/invite.test.ts
git commit -m "feat(server): invite router + owner member management"
```

---

## Task 14: Invite accept page + sharing UI

**Files:**
- Create: `app/invite/[token]/page.tsx`
- Create: `app/_components/SharePanel.tsx`
- Modify: `app/_components/AccountPicker.tsx` (add "Manage sharing" entry for owners → opens SharePanel dialog)

**Interfaces:**
- Consumes: `trpc.invite.get/accept/create`, `trpc.account.members/updateMemberPerms/removeMember`, `useActiveAccount`.
- Produces: invite page (sign-in gate handled by existing middleware redirect; after auth shows accept/decline), and a sharing dialog (create link with perm checkboxes + copyable URL + members list with revoke).

- [ ] **Step 1: Implement invite page**

```tsx
"use client";
import { use } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { useActiveAccount } from "@/app/_components/AccountContext";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const { setAccountId } = useActiveAccount();
  const { data, error, isLoading } = trpc.invite.get.useQuery({ token }, { retry: false });
  const accept = trpc.invite.accept.useMutation({
    onSuccess: (r) => { setAccountId(r.accountId); router.push("/"); },
  });

  if (isLoading) return <div className="p-8">Loading…</div>;
  if (error) return <div className="p-8">{error.message}</div>;
  return (
    <div className="mx-auto max-w-md p-8 space-y-4">
      <h1 className="text-xl font-bold">{data!.sharedByName} shared an account with you</h1>
      <p><strong>{data!.accountName}</strong></p>
      <ul className="text-sm text-muted-foreground list-disc pl-5">
        {data!.perms.canEditItems && <li>Can edit items</li>}
        {data!.perms.canEditOverrides && <li>Can edit overrides</li>}
        {data!.perms.canEditHolidays && <li>Can edit holidays</li>}
        {data!.perms.canUpdateBalance && <li>Can update balance</li>}
        {!data!.perms.canEditItems && !data!.perms.canEditOverrides && !data!.perms.canEditHolidays && !data!.perms.canUpdateBalance && <li>View only</li>}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => accept.mutate({ token })} disabled={accept.isPending}>Accept</Button>
        <Button variant="outline" onClick={() => router.push("/")}>Decline</Button>
      </div>
    </div>
  );
}
```

Note: confirm `middleware.ts` allows `/invite/...` only for authenticated users (it should redirect to login then back). If middleware blocks unauthenticated access, that's the desired sign-in gate; verify the post-login redirect returns to the invite URL. Read `middleware.ts` and, if it has an explicit allowlist of authed routes, ensure `/invite` is treated as protected (so login is forced) — adjust matcher if needed.

- [ ] **Step 2: Implement SharePanel.tsx**

```tsx
"use client";
import { useState } from "react";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "./AccountContext";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";

export function SharePanel() {
  const { accountId } = useActiveAccount();
  const utils = trpc.useUtils();
  const [perms, setPerms] = useState({ canEditItems: false, canEditOverrides: false, canEditHolidays: false, canUpdateBalance: false });
  const [url, setUrl] = useState<string | null>(null);
  const members = trpc.account.members.useQuery({ accountId: accountId! }, { enabled: !!accountId });
  const create = trpc.invite.create.useMutation({
    onSuccess: (r) => setUrl(`${window.location.origin}${r.url}`),
  });
  const remove = trpc.account.removeMember.useMutation({ onSuccess: () => members.refetch() });
  const toggle = (k: keyof typeof perms) => setPerms((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {(["canEditItems","canEditOverrides","canEditHolidays","canUpdateBalance"] as const).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <Checkbox id={k} checked={perms[k]} onCheckedChange={() => toggle(k)} />
            <Label htmlFor={k}>{k.replace("can","").replace(/([A-Z])/g," $1").trim()}</Label>
          </div>
        ))}
        <Button onClick={() => create.mutate({ accountId: accountId!, ...perms })}>Create share link</Button>
        {url && <input readOnly value={url} className="w-full border rounded px-2 py-1 text-sm" onFocus={(e) => e.target.select()} />}
      </div>
      <div>
        <h3 className="font-medium text-sm mb-1">Members</h3>
        {members.data?.filter((m) => m.role === "MEMBER").map((m) => (
          <div key={m.userId} className="flex items-center justify-between text-sm py-1">
            <span>{m.name ?? m.email}</span>
            <Button variant="ghost" size="sm" onClick={() => remove.mutate({ accountId: accountId!, userId: m.userId })}>Remove</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add "Manage sharing" to AccountPicker for owners**

Render a Dialog (existing `ui/dialog`) containing `<SharePanel />`, triggered by a DropdownMenuItem shown only when `activeMembership?.role === "OWNER"`. Keep the dialog open state local to AccountPicker.

- [ ] **Step 4: Typecheck + manual smoke**

Run: `npm run typecheck`
Expected: PASS.
Manual (two browser profiles / incognito): owner creates link → open link as second Google user → accept → confirm the shared account appears in their picker with the granted perms; revoke from owner → confirm it disappears for the member on refetch.

- [ ] **Step 5: Commit**

```bash
git add app/invite/[token]/page.tsx app/_components/SharePanel.tsx app/_components/AccountPicker.tsx
git commit -m "feat(client): invite accept page + account sharing panel"
```

---

## Task 15: Full suite + typecheck + final verification

**Files:** none (verification task)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: PASS — all engine, schema, budget, router, permission, default-account, invite, and context tests green.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm run build`
Expected: build succeeds (App Router compiles `app/invite/[token]`).

- [ ] **Step 3: Manual end-to-end smoke**

Start dev on a free port (`npx next dev -p 3210`). Verify: bootstrap on fresh login, create/switch/default/close accounts, data isolation between accounts, permission-gated UI for a shared member, single-use link rejection on second use.

- [ ] **Step 4: Commit any verification fixes**

```bash
git add -A
git commit -m "test: verify multi-account & collaboration end-to-end"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** AccountMembership (T1), migration/backfill (T2), permission gate (T3), default invariant (T4/T8), accountProcedure/resolveMembership/bootstrap (T5), per-account categories (T6), router gating (T7), account CRUD/close/leave (T8), client context + accountId threading (T9), picker + perm-aware UI (T10), ShareInvite (T11), invite helpers (T12), invite router + member mgmt (T13), invite page + share UI (T14), verification (T15). All design sections mapped.
- **accountId-in-input gotcha:** flagged explicitly in T7 (destructure `accountId` out before spreading into Prisma `data`).
- **Type consistency:** capability names (`editItems|editOverrides|editHolidays|updateBalance`) and perm flags (`canEdit*`/`canUpdateBalance`) are identical across permissions, schema, invite, and UI.
- **DB-push model:** no Prisma migration files; backfill is a standalone idempotent script (T2).
