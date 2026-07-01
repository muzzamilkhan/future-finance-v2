# Items Labels & All-Accounts View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Items page human-readable recurrence labels, show items from every account the user belongs to (transfers on both sides), let Add forms pick a target account, and fix the missing delete confirmation.

**Architecture:** A pure `frequencyLabel` helper + two new date helpers drive label rendering. A new pure `buildListAllRows` function and a thin `particular.listAll` tRPC query produce a flat, account-tagged, transfer-echoed row list; the Items page and its Add/Delete flows migrate from `particular.list` to `listAll`. Add forms gain an Account select; edit does not.

**Tech Stack:** Next.js 16 (App Router), React 19, tRPC 11, Prisma 7, Zod 4, Vitest, react-hook-form, date-fns, Tailwind v4.

## Global Constraints

- Test runner is **Vitest** everywhere. No Playwright.
- `lib/engine/` and `lib/schemas/` stay free of React/Prisma/Next imports. `frequencyLabel.ts` lives under `app/particulars/` and may import from `lib/`.
- All date field extraction uses **UTC** accessors (`getUTCDate`, `getUTCMonth`, `getUTCFullYear`) and UTC `Intl.DateTimeFormat` — never local-time.
- "Today" is **passed in** as a UTC-anchored `Date`, never read from the clock inside pure helpers.
- Currency via existing `formatCurrency` (NZD).
- `Particular.amount` is stored **positive**; sign comes from `type` / transfer direction at render time.
- Commit once per completed task.
- `particular.list` is used by other pages (dashboard, spending, OverrideModal, CategoryPill, OverrideManagement) and must **not** be removed or changed. Only the Items page (`page.tsx`, `QuickAddRow`, `ParticularForm`) migrates to `listAll`.

---

## File Structure

- `lib/dateInput.ts` (modify) — add `formatUtcWeekdayLong`, `ordinal`.
- `app/particulars/frequencyLabel.ts` (create) — pure `frequencyLabel(p, today)`.
- `app/particulars/frequencyLabel.test.ts` (create) — Vitest.
- `lib/dateInput.test.ts` (modify/create) — tests for the two new helpers.
- `server/routers/particular.ts` (modify) — add pure `buildListAllRows` + `listAll` query.
- `server/routers/particular.test.ts` (modify) — tests for `buildListAllRows`.
- `app/particulars/page.tsx` (modify) — consume `listAll`, badges, signs, per-row perms, delete-confirm fix.
- `app/particulars/QuickAddRow.tsx` (modify) — account select + `listAll` optimistic cache.
- `app/particulars/ParticularForm.tsx` (modify) — account select on add + `listAll` optimistic cache.

---

## Task 1: Date helpers — `ordinal` and `formatUtcWeekdayLong`

**Files:**
- Modify: `lib/dateInput.ts`
- Test: `lib/dateInput.test.ts`

**Interfaces:**
- Produces: `ordinal(n: number): string` (`"1st"`, `"2nd"`, `"3rd"`, `"11th"`, `"14th"`, `"21st"`, `"22nd"`, `"23rd"`); `formatUtcWeekdayLong(date: Date): string` (`"Monday"`).

- [ ] **Step 1: Write the failing tests**

Add to `lib/dateInput.test.ts` (create the file with the imports below if it does not exist; if it exists, add these `describe` blocks and merge the import):

```ts
import { describe, it, expect } from "vitest";
import { ordinal, formatUtcWeekdayLong } from "./dateInput";

describe("ordinal", () => {
  it("handles the common ones/twos/threes", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
  });
  it("handles the teens as th", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(14)).toBe("14th");
  });
  it("handles the twenties", () => {
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(23)).toBe("23rd");
    expect(ordinal(26)).toBe("26th");
  });
});

describe("formatUtcWeekdayLong", () => {
  it("returns the full UTC weekday name", () => {
    // 2026-08-26 is a Wednesday
    expect(formatUtcWeekdayLong(new Date(Date.UTC(2026, 7, 26)))).toBe("Wednesday");
    // 2026-07-06 is a Monday
    expect(formatUtcWeekdayLong(new Date(Date.UTC(2026, 6, 6)))).toBe("Monday");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/dateInput.test.ts`
Expected: FAIL — `ordinal`/`formatUtcWeekdayLong` are not exported.

- [ ] **Step 3: Implement the helpers**

In `lib/dateInput.ts`, add a new formatter next to the existing `utcWeekday` const:

```ts
const utcWeekdayLong = new Intl.DateTimeFormat("en-US", {
  weekday: "long", timeZone: "UTC",
});
```

Then add these exported functions (place them after `formatUtcWeekday`):

```ts
/** "Monday" — full weekday in UTC. */
export function formatUtcWeekdayLong(date: Date): string {
  return utcWeekdayLong.format(date);
}

/** "1st", "2nd", "3rd", "14th", "21st" — English ordinal for a day-of-month. */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/dateInput.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dateInput.ts lib/dateInput.test.ts
git commit -m "feat(dates): add ordinal and formatUtcWeekdayLong helpers"
```

---

## Task 2: `frequencyLabel` pure helper

**Files:**
- Create: `app/particulars/frequencyLabel.ts`
- Test: `app/particulars/frequencyLabel.test.ts`

**Interfaces:**
- Consumes: `ordinal`, `formatUtcWeekdayLong`, `formatUtcWeekday`, `formatUtcMonthDay`, `formatUtcMonthDayYear` from `@/lib/dateInput`; `addWeeks` from `date-fns`.
- Produces: `frequencyLabel(p: { frequency: Frequency; startDate: Date }, today: Date): string` where `Frequency = "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL"`.

**Notes on derivation (must match exactly):**
- MONTHLY → `Every ${ordinal(startDate.getUTCDate())}` → `"Every 14th"`.
- WEEKLY → `Every ${formatUtcWeekdayLong(startDate)}` → `"Every Monday"`.
- ANNUAL → `Every ${ordinal(day)} ${shortMonth}` where day = `startDate.getUTCDate()`, and `shortMonth` is the month token from `formatUtcMonthDay(startDate)` (which yields `"Aug 26"` → take the `"Aug"` part) → `"Every 26th Aug"`.
- ONCE_OFF → `${ordinal(day)} ${shortMonth}, ${year}` → `"26th Aug, 2026"`. Use `formatUtcMonthDayYear` only for the month token / year is `startDate.getUTCFullYear()`.
- FORTNIGHTLY → see algorithm in code below. Mon–Sun week.

To avoid parsing formatter output for the month token, derive the short month from a small local constant array indexed by `startDate.getUTCMonth()`.

- [ ] **Step 1: Write the failing tests**

Create `app/particulars/frequencyLabel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { frequencyLabel } from "./frequencyLabel";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

describe("frequencyLabel", () => {
  it("labels MONTHLY by ordinal day", () => {
    expect(frequencyLabel({ frequency: "MONTHLY", startDate: d(2026, 1, 14) }, d(2026, 7, 1)))
      .toBe("Every 14th");
  });

  it("labels WEEKLY by full weekday", () => {
    // 2026-07-06 is a Monday
    expect(frequencyLabel({ frequency: "WEEKLY", startDate: d(2026, 7, 6) }, d(2026, 7, 1)))
      .toBe("Every Monday");
  });

  it("labels ANNUAL as Every <day> <month>", () => {
    expect(frequencyLabel({ frequency: "ANNUAL", startDate: d(2025, 8, 26) }, d(2026, 7, 1)))
      .toBe("Every 26th Aug");
  });

  it("labels ONCE_OFF as <day> <month>, <year>", () => {
    expect(frequencyLabel({ frequency: "ONCE_OFF", startDate: d(2026, 8, 26) }, d(2026, 7, 1)))
      .toBe("26th Aug, 2026");
  });

  describe("FORTNIGHTLY (Mon-Sun weeks)", () => {
    // Start Tue 2026-06-30. Occurrences: 06-30, 07-14, 07-28, ...
    const start = d(2026, 6, 30);

    it("says This <weekday> when the next occurrence is in today's Mon-Sun week", () => {
      // today Mon 2026-06-29 -> same Mon-Sun week (06-29..07-05) as occurrence 06-30
      expect(frequencyLabel({ frequency: "FORTNIGHTLY", startDate: start }, d(2026, 6, 29)))
        .toBe("This Tue");
    });

    it("says Next <weekday> when the next occurrence is in the following week", () => {
      // today Mon 2026-07-06 -> next occurrence 07-14 is in week 07-13..07-19 (following week)
      expect(frequencyLabel({ frequency: "FORTNIGHTLY", startDate: start }, d(2026, 7, 6)))
        .toBe("Next Tue");
    });

    it("falls back to Every other <weekday> when the next hit is 2+ weeks out", () => {
      // today Mon 2026-06-15 -> next occurrence 06-30 is two weeks out (weeks: cur 06-15, next 06-22, then 06-29)
      expect(frequencyLabel({ frequency: "FORTNIGHTLY", startDate: start }, d(2026, 6, 15)))
        .toBe("Every other Tue");
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/particulars/frequencyLabel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `frequencyLabel`**

Create `app/particulars/frequencyLabel.ts`:

```ts
import { addWeeks } from "date-fns";
import { ordinal, formatUtcWeekdayLong, formatUtcWeekday } from "@/lib/dateInput";

type Frequency = "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL";

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** UTC-midnight of the Monday that starts the Mon-Sun week containing `date`. */
function mondayOfUtcWeek(date: Date): Date {
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon->0, Sun->6
  return new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday,
  ));
}

/** First fortnightly occurrence on/after `today`, stepping 2 weeks from `start`. */
function nextFortnightly(start: Date, today: Date): Date {
  let occ = start;
  while (occ.getTime() < today.getTime()) occ = addWeeks(occ, 2);
  return occ;
}

/**
 * Human-readable recurrence label. `today` is a UTC-anchored date, passed in —
 * never read from the clock. All date fields read via UTC accessors.
 */
export function frequencyLabel(
  p: { frequency: Frequency; startDate: Date },
  today: Date,
): string {
  const s = p.startDate;
  const day = ordinal(s.getUTCDate());
  const month = SHORT_MONTHS[s.getUTCMonth()];

  switch (p.frequency) {
    case "MONTHLY":
      return `Every ${day}`;
    case "WEEKLY":
      return `Every ${formatUtcWeekdayLong(s)}`;
    case "ANNUAL":
      return `Every ${day} ${month}`;
    case "ONCE_OFF":
      return `${day} ${month}, ${s.getUTCFullYear()}`;
    case "FORTNIGHTLY": {
      const weekday = formatUtcWeekday(s); // "Tue"
      const occ = nextFortnightly(s, today);
      const thisWeek = mondayOfUtcWeek(today);
      const nextWeek = addWeeks(thisWeek, 1);
      const occWeek = mondayOfUtcWeek(occ);
      if (occWeek.getTime() === thisWeek.getTime()) return `This ${weekday}`;
      if (occWeek.getTime() === nextWeek.getTime()) return `Next ${weekday}`;
      return `Every other ${weekday}`;
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/particulars/frequencyLabel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/particulars/frequencyLabel.ts app/particulars/frequencyLabel.test.ts
git commit -m "feat(items): add frequencyLabel helper for human-readable recurrence"
```

---

## Task 3: `buildListAllRows` pure function + `particular.listAll` query

**Files:**
- Modify: `server/routers/particular.ts`
- Test: `server/routers/particular.test.ts`

**Interfaces:**
- Consumes: existing `particularRouter`, `protectedProcedure`, `ownedAccountIds`; Prisma `particular.findMany`, `accountMembership.findMany`.
- Produces:
  - `type ListAllRow = FetchedParticular & { accountId: string; accountName: string; direction: "OUT" | "IN"; canEditItems: boolean; }`
  - `buildListAllRows(particulars, accountMeta): ListAllRow[]` — pure.
  - `particular.listAll` tRPC query (protectedProcedure, no input) returning `ListAllRow[]`.

Where `accountMeta` is `Map<string, { name: string; canEditItems: boolean }>` keyed by accountId (only the user's own accounts).

- [ ] **Step 1: Write the failing test**

Add to `server/routers/particular.test.ts`:

```ts
import { buildListAllRows } from "./particular";

describe("buildListAllRows", () => {
  const meta = new Map([
    ["debit", { name: "Everyday", canEditItems: true }],
    ["credit", { name: "Visa", canEditItems: false }],
  ]);

  const base = {
    startDate: new Date("2026-01-01"), amount: 10, frequency: "MONTHLY",
    isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    category: null, overrides: [],
  };

  it("tags own-account rows as OUT with account meta", () => {
    const rows = buildListAllRows(
      [{ ...base, id: "p1", name: "Salary", type: "INCOME", accountId: "debit", toAccountId: null }],
      meta,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "p1", direction: "OUT", accountId: "debit", accountName: "Everyday", canEditItems: true,
    });
  });

  it("emits an IN echo on the to-account for a transfer between own accounts", () => {
    const rows = buildListAllRows(
      [{ ...base, id: "t1", name: "Pay card", type: "TRANSFER", accountId: "debit", toAccountId: "credit" }],
      meta,
    );
    expect(rows).toHaveLength(2);
    const out = rows.find((r) => r.direction === "OUT")!;
    const inn = rows.find((r) => r.direction === "IN")!;
    expect(out).toMatchObject({ accountId: "debit", accountName: "Everyday", canEditItems: true });
    expect(inn).toMatchObject({ accountId: "credit", accountName: "Visa", canEditItems: false });
    expect(inn.id).toBe("t1");
  });

  it("emits only the OUT row when the to-account is not one of the user's accounts", () => {
    const rows = buildListAllRows(
      [{ ...base, id: "t2", name: "Rent", type: "TRANSFER", accountId: "debit", toAccountId: "external" }],
      meta,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe("OUT");
  });

  it("forces canEditItems false on IN echoes even when the to-account is editable", () => {
    const editableBoth = new Map([
      ["a", { name: "A", canEditItems: true }],
      ["b", { name: "B", canEditItems: true }],
    ]);
    const rows = buildListAllRows(
      [{ ...base, id: "t3", name: "Move", type: "TRANSFER", accountId: "a", toAccountId: "b" }],
      editableBoth,
    );
    expect(rows.find((r) => r.direction === "IN")!.canEditItems).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/routers/particular.test.ts`
Expected: FAIL — `buildListAllRows` not exported.

- [ ] **Step 3: Implement `buildListAllRows` and the `listAll` query**

In `server/routers/particular.ts`, add the pure function above the `particularRouter` definition:

```ts
type FetchedParticular = {
  id: string; name: string; type: "INCOME" | "EXPENSE" | "TRANSFER";
  accountId: string; toAccountId: string | null;
  [key: string]: unknown;
};

export type ListAllRow = FetchedParticular & {
  accountName: string;
  direction: "OUT" | "IN";
  canEditItems: boolean;
};

/**
 * Flatten fetched particulars into display rows. Each row is tagged with the
 * account it displays under. Transfers whose destination is one of the user's
 * own accounts additionally emit a read-only IN echo on that to-account.
 * Pure — no Prisma, no clock.
 */
export function buildListAllRows(
  particulars: FetchedParticular[],
  accountMeta: Map<string, { name: string; canEditItems: boolean }>,
): ListAllRow[] {
  const rows: ListAllRow[] = [];
  for (const p of particulars) {
    const from = accountMeta.get(p.accountId);
    if (from) {
      rows.push({ ...p, accountName: from.name, direction: "OUT", canEditItems: from.canEditItems });
    }
    if (p.type === "TRANSFER" && p.toAccountId) {
      const to = accountMeta.get(p.toAccountId);
      if (to) {
        rows.push({ ...p, accountId: p.toAccountId, accountName: to.name, direction: "IN", canEditItems: false });
      }
    }
  }
  return rows;
}
```

Then add the `listAll` query inside `particularRouter` (next to `list`):

```ts
listAll: protectedProcedure.query(async ({ ctx }) => {
  const memberships = await ctx.prisma.accountMembership.findMany({
    where: { userId: ctx.user.id, account: { closedAt: null } },
    select: { canEditItems: true, account: { select: { id: true, name: true } } },
  });
  const accountMeta = new Map(
    memberships.map((m) => [m.account.id, { name: m.account.name, canEditItems: m.canEditItems }]),
  );
  const particulars = await ctx.prisma.particular.findMany({
    where: { accountId: { in: [...accountMeta.keys()] } },
    include: { overrides: true },
    orderBy: { startDate: "asc" },
  });
  return buildListAllRows(particulars as never, accountMeta);
}),
```

Ensure `protectedProcedure` is imported in this file (it already imports from `../trpc`; add it to the import if missing).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/routers/particular.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the server router**

Run: `npx tsc --noEmit`
Expected: no new errors from `particular.ts`.

- [ ] **Step 6: Commit**

```bash
git add server/routers/particular.ts server/routers/particular.test.ts
git commit -m "feat(items): add particular.listAll with cross-account transfer echoes"
```

---

## Task 4: Items page consumes `listAll` — badges, signs, per-row perms, delete confirm

**Files:**
- Modify: `app/particulars/page.tsx`

**Interfaces:**
- Consumes: `trpc.particular.listAll`, `frequencyLabel`, `todayAsUtcDate`, the `ListAllRow` shape (`direction`, `accountName`, `accountId`, `canEditItems`).

- [ ] **Step 1: Switch the query and row type**

In `app/particulars/page.tsx`:

Replace the `Particular` type alias (line 20) with the `listAll` row type:

```tsx
type Particular = inferRouterOutputs<AppRouter>["particular"]["listAll"][number];
```

Replace the query (lines 30–33) with:

```tsx
const { data: particulars, isLoading } = trpc.particular.listAll.useQuery();
```

Remove the now-unused `{ accountId: accountId! }` argument usages tied to the old query. Keep `accountId` from `useActiveAccount()` — it is still the default for Add forms and the account switcher.

- [ ] **Step 2: Update delete + reassign mutations to the `listAll` cache**

The `del` mutation's `onMutate` currently keys `particular.list` by `{ accountId }`. Replace its body with `listAll` (no key):

```tsx
const del = trpc.particular.delete.useMutation({
  onMutate: async (vars) => {
    await utils.particular.listAll.cancel();
    const prev = utils.particular.listAll.getData();
    utils.particular.listAll.setData(undefined, (old) => (old ?? []).filter((r) => r.id !== vars.id));
    return { prev };
  },
  onError: (_e, _vars, ctx) => {
    if (ctx) utils.particular.listAll.setData(undefined, ctx.prev);
  },
  onSettled: () => { utils.particular.listAll.invalidate(); utils.forecast.getData.invalidate(); },
});
```

In the `reassign` mutation, replace its `particular.list` cache calls the same way (cancel/getData/setData/invalidate on `listAll`, filtering by `r.id !== vars.id`), and keep the `forecast` invalidations it already has.

- [ ] **Step 3: Row keys, badges, signs, per-row perms**

Update `renderRow`:

- Key by direction to keep IN echoes unique:
  ```tsx
  <div key={`${p.id}-${p.direction}`} ...>
  ```
- Signed amount honours transfer direction:
  ```tsx
  const signed =
    p.type === "EXPENSE" ? -Math.abs(Number(p.amount))
    : p.type === "TRANSFER" ? (p.direction === "IN" ? Math.abs(Number(p.amount)) : -Math.abs(Number(p.amount)))
    : Math.abs(Number(p.amount));
  ```
- Replace the frequency `<span>` (old lines 92–95) with:
  ```tsx
  <span className="ml-2 text-xs text-muted-foreground">{frequencyLabel(p, today)}</span>
  ```
  where `const today = todayAsUtcDate();` is declared once in the component body. Import `frequencyLabel` from `./frequencyLabel` and `todayAsUtcDate` from `@/lib/dateInput` (replace the now-unused `formatUtcWeekday` import).
- Add an account badge pill after the name button (mirroring `CategoryPill` styling):
  ```tsx
  <span className="ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
    {p.accountName}
  </span>
  ```
- Gate the action buttons on the **row's** perms. Replace every `!canEditItems` in `renderRow`'s buttons with `!p.canEditItems`, and pass the row's account to mutations:
  - Edit button: `disabled={!p.canEditItems || isTempId(p.id)}` (unchanged onClick — the form loads by id).
  - Move button condition unchanged, but `disabled={!p.canEditItems || isTempId(p.id)}`.
  - Delete button: `disabled={!p.canEditItems || isTempId(p.id)}` and **fix the confirmation** (next step).

- [ ] **Step 4: Fix the delete confirmation**

Change the Delete button's onClick from the direct mutate to opening the dialog:

```tsx
<Button variant="ghost" size="sm" disabled={!p.canEditItems || isTempId(p.id)} onClick={() => setPendingDelete(p)}>Delete</Button>
```

Update the confirmation dialog's confirm button to delete using the **pending row's** account:

```tsx
onClick={() => { if (pendingDelete) del.mutate({ accountId: pendingDelete.accountId, id: pendingDelete.id }); }}
```

- [ ] **Step 5: Verify build + typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `page.tsx` (all `p.canEditItems`, `p.direction`, `p.accountName`, `p.accountId` resolve on the `listAll` row type).

Run: `npx vitest run` (full suite) — Expected: PASS (no page tests, but ensures nothing imported broke).

- [ ] **Step 6: Manual smoke (record result)**

Confirm on the running dev app: Items page lists items from all accounts, each with an account badge; a transfer between two of your accounts appears twice (negative on from, positive on to); the IN echo has no enabled Edit/Delete; Delete now opens a confirm dialog. Note the observed result in the commit body.

- [ ] **Step 7: Commit**

```bash
git add app/particulars/page.tsx
git commit -m "feat(items): show all accounts with badges, transfer signs, per-row perms; fix delete confirm"
```

---

## Task 5: QuickAddRow — account select + `listAll` optimistic cache

**Files:**
- Modify: `app/particulars/QuickAddRow.tsx`

**Interfaces:**
- Consumes: `useActiveAccount()` (`accountId`, `accounts`), `trpc.particular.listAll`, `trpc.particular.create`.

- [ ] **Step 1: Add account to form defaults and a selector**

In `defaults()`, the account is not part of `particularInput` output we want to reset per-row; track the selected account in React state instead:

```tsx
const { accountId, accounts } = useActiveAccount();
const [selectedAccount, setSelectedAccount] = useState<string>("");
useEffect(() => { if (accountId && !selectedAccount) setSelectedAccount(accountId); }, [accountId, selectedAccount]);
```

(Import `useState`, `useEffect` from `react`.)

Add an Account `<Select>` before the Add button, listing only editable accounts:

```tsx
<Select value={selectedAccount} onValueChange={setSelectedAccount}>
  <SelectTrigger className="w-40"><SelectValue placeholder="Account" /></SelectTrigger>
  <SelectContent>
    {accounts.filter((a) => a.canEditItems).map((a) => (
      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

- [ ] **Step 2: Migrate the optimistic cache to `listAll`**

Replace the `create` mutation's `onMutate`/`onError`/`onSettled` to operate on `listAll` (a flat list). The optimistic row must carry the extra `listAll` fields:

```tsx
const create = trpc.particular.create.useMutation({
  onMutate: async (vars) => {
    await utils.particular.listAll.cancel();
    const prev = utils.particular.listAll.getData();
    const acct = accounts.find((a) => a.id === vars.accountId);
    utils.particular.listAll.setData(undefined, (old) =>
      addRow(old, {
        id: newTempId(),
        name: vars.name, type: vars.type, amount: vars.amount, frequency: vars.frequency,
        startDate: vars.startDate as Date, endDate: (vars.endDate as Date | undefined) ?? null,
        isCritical: vars.isCritical, isFixed: vars.isFixed,
        businessDayAdjustment: vars.businessDayAdjustment, category: vars.category ?? null,
        accountId: vars.accountId, toAccountId: null,
        accountName: acct?.name ?? "", direction: "OUT", canEditItems: true,
        overrides: [],
      } as never),
    );
    return { prev };
  },
  onError: (error, variables, ctx) => {
    if (ctx) utils.particular.listAll.setData(undefined, ctx.prev);
    toast.error(`Couldn't add “${variables.name}”`, { description: error.message });
  },
  onSettled: () => {
    utils.particular.listAll.invalidate();
    utils.forecast.getData.invalidate();
  },
});
```

- [ ] **Step 3: Submit uses the selected account and resets it**

```tsx
const submit = form.handleSubmit((values) => {
  create.mutate({ accountId: selectedAccount || accountId!, ...values });
  form.reset(defaults());
  form.setFocus("name");
  setSelectedAccount(accountId!);
});
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `QuickAddRow.tsx`.

- [ ] **Step 5: Manual smoke (record result)**

On the dev app: QuickAdd shows an Account selector defaulting to the active account; adding an item to a *different* account makes it appear (optimistically then confirmed) under that account's badge on the Items page.

- [ ] **Step 6: Commit**

```bash
git add app/particulars/QuickAddRow.tsx
git commit -m "feat(items): QuickAdd account selector; migrate optimistic cache to listAll"
```

---

## Task 6: ParticularForm — account select on add + `listAll` optimistic cache

**Files:**
- Modify: `app/particulars/ParticularForm.tsx`

**Interfaces:**
- Consumes: `useActiveAccount()` (`accountId`, `accounts`), `trpc.particular.listAll`, `trpc.particular.create`, `trpc.particular.update`.

**Context:** This form already has a "From account" selector rendered **only for TRANSFER** that sets form field `accountId`, but `submit` currently overrides `accountId: accountId!`, clobbering it. The fix below makes the submitted account come from the form for creates (both transfer and non-transfer), while keeping updates pinned to the item's existing account.

- [ ] **Step 1: Load `existing` via `listAll`; keep accounts**

Replace the `existing` query so edit still resolves the row now that the page uses `listAll`:

```tsx
const { data: existing } = trpc.particular.listAll.useQuery(undefined, {
  select: (rows) => rows.find((r) => r.id === particularId && r.direction === "OUT") ?? null,
  enabled: !!particularId,
});
```

(`accounts` continues to come from `useActiveAccount()` or the existing `account.list` query — use `useActiveAccount()` for consistency: `const { accountId, accounts } = useActiveAccount();`.)

- [ ] **Step 2: Add an Account selector for non-transfer creates**

The transfer branch already renders From/To account selects. For **non-transfer creates**, add an Account select. Render it only when creating and type ≠ TRANSFER:

```tsx
{!particularId && form.watch("type") !== "TRANSFER" && (
  <div className="space-y-1">
    <Label>Account</Label>
    <Select
      value={(form.watch("accountId") as string | undefined) ?? accountId ?? ""}
      onValueChange={(v) => form.setValue("accountId", v)}
    >
      <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
      <SelectContent>
        {accounts.filter((a) => a.canEditItems).map((a) => (
          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
)}
```

Set the form default for `accountId` to the active account so a create without touching the selector still targets it. In `defaultValues` add `accountId: accountId ?? undefined`.

- [ ] **Step 3: Submit — account from form on create, pinned on update**

Replace `submit` (lines ~105–109):

```tsx
const submit = form.handleSubmit((values) => {
  if (particularId) {
    // Account is not editable on update; keep the item on its existing account.
    update.mutate({ ...values, accountId: existing?.accountId ?? accountId!, id: particularId });
  } else {
    create.mutate({ ...values, accountId: (values.accountId as string | undefined) || accountId! });
  }
  onClose();
});
```

- [ ] **Step 4: Migrate create/update optimistic caches to `listAll`**

Replace `key`, `onMutationError`, `onSettled`, and both mutations' cache operations to use `listAll`:

```tsx
const onMutationError = (error: { message: string }, _vars: unknown, ctx?: { prev: unknown }) => {
  if (ctx) utils.particular.listAll.setData(undefined, ctx.prev as never);
  toast.error(particularId ? "Couldn't save changes" : "Couldn't add item", { description: error.message });
};
const onSettled = () => { utils.particular.listAll.invalidate(); utils.forecast.getData.invalidate(); };

const create = trpc.particular.create.useMutation({
  onMutate: async (vars) => {
    await utils.particular.listAll.cancel();
    const prev = utils.particular.listAll.getData();
    const acct = accounts.find((a) => a.id === vars.accountId);
    utils.particular.listAll.setData(undefined, (old) =>
      addRow(old, {
        id: newTempId(),
        name: vars.name, type: vars.type, amount: vars.amount, frequency: vars.frequency,
        startDate: vars.startDate as Date, endDate: (vars.endDate as Date | undefined) ?? null,
        isCritical: vars.isCritical, isFixed: vars.isFixed,
        businessDayAdjustment: vars.businessDayAdjustment, category: vars.category ?? null,
        accountId: vars.accountId!, toAccountId: (vars.toAccountId as string | undefined) ?? null,
        accountName: acct?.name ?? "", direction: "OUT", canEditItems: true, overrides: [],
      } as never),
    );
    return { prev };
  },
  onError: onMutationError,
  onSettled,
});
const update = trpc.particular.update.useMutation({
  onMutate: async (vars) => {
    await utils.particular.listAll.cancel();
    const prev = utils.particular.listAll.getData();
    utils.particular.listAll.setData(undefined, (old) =>
      updateRow(old, vars.id, {
        name: vars.name, type: vars.type, amount: vars.amount, frequency: vars.frequency,
        startDate: vars.startDate as Date, endDate: (vars.endDate as Date | undefined) ?? null,
        isCritical: vars.isCritical, isFixed: vars.isFixed,
        businessDayAdjustment: vars.businessDayAdjustment, category: vars.category ?? null,
        toAccountId: (vars.toAccountId as string | undefined) ?? null,
      } as never),
    );
    return { prev };
  },
  onError: onMutationError,
  onSettled,
});
```

(`addRow`/`updateRow`/`newTempId` are already imported.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `ParticularForm.tsx`.

- [ ] **Step 6: Manual smoke (record result)**

On the dev app: opening the full Add form shows an Account selector (non-transfer) defaulting to the active account; creating targets the chosen account. Editing an existing item shows **no** account selector, and Save keeps it on its account. Transfer add still shows From/To and now respects the chosen From account.

- [ ] **Step 7: Commit**

```bash
git add app/particulars/ParticularForm.tsx
git commit -m "feat(items): ParticularForm account selector on add; fix transfer from-account; migrate cache to listAll"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint (if configured)**

Run: `npm run lint`
Expected: PASS (or no new violations).

- [ ] **Step 4: Final manual pass (record result)**

Verify end to end on the dev app: labels read "Every 14th" / "Every Monday" / "This Tue"–"Next Tue" / "Every 26th Aug" / "26th Aug, 2026"; all-accounts view with badges; transfer double-sided signs; Add forms pick account; edit has no account field; delete confirms.

---

## Self-Review Notes

- **Spec coverage:** Part 1 labels → Tasks 1–2 + Task 4 Step 3. Part 2 all-accounts/echoes/badges/signs/per-row perms → Task 3 + Task 4. Optimistic migration → Tasks 4–6. Part 3 add-form account selection (add only, not edit) → Tasks 5–6. Part 4 delete-confirm fix → Task 4 Step 4. `particular.list` preserved for other callers → Global Constraints + only Items-page files migrated.
- **Placeholders:** none — every code step contains full code.
- **Type consistency:** `ListAllRow` fields (`direction`, `accountName`, `accountId`, `canEditItems`, `overrides`) are produced in Task 3 and consumed identically in Tasks 4–6. `frequencyLabel(p, today)` signature consistent across Task 2 and Task 4.
