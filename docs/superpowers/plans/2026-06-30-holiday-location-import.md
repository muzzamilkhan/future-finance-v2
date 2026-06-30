# Holiday Location-Based Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users import a country's (and optional state's) public holidays into an account from Nager.Date, with re-import correcting moving dates in place and no duplicates.

**Architecture:** Holidays stay account-scoped. A pure `lib/holidayImport.ts` module fetches + validates + filters Nager data and plans upserts (fully unit-tested with mocked `fetch`). A thin `holiday` tRPC router adds `availableCountries`, `subdivisions`, and `import` procedures that execute those plans. The holidays page gains an import panel. The forecast engine is untouched.

**Tech Stack:** Next.js, tRPC, Prisma (Postgres, `prisma db push`), Zod, Vitest, Radix `Select` UI component.

## Global Constraints

- Holidays are **account-scoped** — no global/per-user changes. (spec: Goal)
- Data source: Nager.Date, no API key/proxy. Base URL `https://date.nager.at`. (spec: Data source)
- Import year is the **current year**, derived server-side — never a user input. (spec: Schemas)
- Imported holidays are `source: IMPORTED`, `isRecurring: true`; manual are `source: CUSTOM`. (spec: Schema changes)
- Dedup key: `@@unique([accountId, name, source])`. Re-import upserts IMPORTED rows in place; CUSTOM rows are never touched. (spec: Schema changes)
- Include a holiday iff `global === true` OR (`stateCode` provided AND `counties` includes `stateCode`). (spec: State / subdivision handling)
- Migration via `prisma db push` (this repo has no migrations dir). Non-destructive: existing rows become `CUSTOM`.
- Engine/forecast files are **out of scope** — do not modify. (spec: Forecast / engine)
- Test layout mirrors repo convention: pure helpers tested directly with Vitest + mocked `fetch`; no full tRPC caller. Test files live next to source (`lib/**/*.test.ts`, `app/**/*.test.ts`).

---

### Task 1: Schema — add `source` and change dedup key

**Files:**
- Modify: `prisma/schema.prisma` (Holiday model, ~lines 140-148; add enum near other enums ~line 150)

**Interfaces:**
- Produces: `HolidaySource` enum (`IMPORTED` | `CUSTOM`); `Holiday.source` field; unique key `@@unique([accountId, name, source])`.

- [ ] **Step 1: Add the `HolidaySource` enum**

In `prisma/schema.prisma`, immediately above `model Holiday {`, add:

```prisma
enum HolidaySource {
  IMPORTED
  CUSTOM
}
```

- [ ] **Step 2: Update the Holiday model**

Replace the existing `Holiday` model with:

```prisma
model Holiday {
  id          String         @id @default(cuid())
  accountId   String
  name        String
  date        DateTime       @db.Date
  isRecurring Boolean        @default(false)
  source      HolidaySource  @default(CUSTOM)
  account     FinanceAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  @@unique([accountId, name, source])
}
```

- [ ] **Step 3: Push schema and regenerate client**

Run: `npm run db:push`
Expected: completes without error; prints that `Holiday` was altered and the Prisma Client was regenerated. If it reports a unique-constraint conflict on existing data, inspect/clean duplicate `(accountId, name, source)` rows, then re-run.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (the generated client now knows `source`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(holidays): add source enum and name-based dedup key"
```

---

### Task 2: Import module — Nager fetch + validation + filtering + upsert planner

**Files:**
- Create: `lib/holidayImport.ts`
- Test: `lib/holidayImport.test.ts`

**Interfaces:**
- Consumes: nothing (uses global `fetch`).
- Produces:
  - `type NagerHoliday = { date: string; name: string; global: boolean; counties: string[] | null }`
  - `type ImportedHoliday = { name: string; date: string }`
  - `type UpsertPlan = { name: string; date: string }[]` (alias of `ImportedHoliday[]`)
  - `fetchHolidays(countryCode: string, year: number): Promise<NagerHoliday[]>`
  - `fetchCountries(): Promise<{ countryCode: string; name: string }[]>`
  - `subdivisionsForCountry(countryCode: string, year: number): Promise<string[]>`
  - `filterHolidays(holidays: NagerHoliday[], stateCode?: string): ImportedHoliday[]`

- [ ] **Step 1: Write failing tests**

Create `lib/holidayImport.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchHolidays,
  fetchCountries,
  subdivisionsForCountry,
  filterHolidays,
  type NagerHoliday,
} from "./holidayImport";

const au: NagerHoliday[] = [
  { date: "2026-01-01", name: "New Year's Day", global: true, counties: null },
  { date: "2026-03-02", name: "Labour Day", global: false, counties: ["AU-WA"] },
  { date: "2026-10-05", name: "Labour Day", global: false, counties: ["AU-NSW", "AU-ACT"] },
];

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok, status, json: vi.fn().mockResolvedValue(body),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("filterHolidays", () => {
  it("returns only national holidays when no state given", () => {
    expect(filterHolidays(au)).toEqual([{ name: "New Year's Day", date: "2026-01-01" }]);
  });

  it("includes national + the selected state's holidays only", () => {
    expect(filterHolidays(au, "AU-NSW")).toEqual([
      { name: "New Year's Day", date: "2026-01-01" },
      { name: "Labour Day", date: "2026-10-05" },
    ]);
  });

  it("excludes other states (no same-name collision)", () => {
    const out = filterHolidays(au, "AU-WA");
    expect(out).toEqual([
      { name: "New Year's Day", date: "2026-01-01" },
      { name: "Labour Day", date: "2026-03-02" },
    ]);
  });
});

describe("fetchHolidays", () => {
  it("requests the right URL and parses the array", async () => {
    mockFetchOnce(au);
    const out = await fetchHolidays("AU", 2026);
    expect(fetch).toHaveBeenCalledWith("https://date.nager.at/api/v3/PublicHolidays/2026/AU");
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ name: "New Year's Day", global: true });
  });

  it("throws on a non-200 response", async () => {
    mockFetchOnce({}, false, 404);
    await expect(fetchHolidays("ZZ", 2026)).rejects.toThrow();
  });
});

describe("fetchCountries", () => {
  it("parses the available countries array", async () => {
    mockFetchOnce([{ countryCode: "AU", name: "Australia" }]);
    const out = await fetchCountries();
    expect(out).toEqual([{ countryCode: "AU", name: "Australia" }]);
  });
});

describe("subdivisionsForCountry", () => {
  it("returns sorted distinct county codes", async () => {
    mockFetchOnce(au);
    const out = await subdivisionsForCountry("AU", 2026);
    expect(out).toEqual(["AU-ACT", "AU-NSW", "AU-WA"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/holidayImport.test.ts`
Expected: FAIL — cannot resolve `./holidayImport`.

- [ ] **Step 3: Implement the module**

Create `lib/holidayImport.ts`:

```typescript
import { z } from "zod";

const BASE = "https://date.nager.at/api/v3";

const nagerHolidaySchema = z.object({
  date: z.string(),
  name: z.string(),
  global: z.boolean(),
  counties: z.array(z.string()).nullable(),
});
const nagerHolidaysSchema = z.array(nagerHolidaySchema);

const countriesSchema = z.array(z.object({
  countryCode: z.string(),
  name: z.string(),
}));

export type NagerHoliday = z.infer<typeof nagerHolidaySchema>;
export type ImportedHoliday = { name: string; date: string };

export async function fetchHolidays(countryCode: string, year: number): Promise<NagerHoliday[]> {
  const res = await fetch(`${BASE}/PublicHolidays/${year}/${countryCode}`);
  if (!res.ok) throw new Error(`Failed to fetch holidays for ${countryCode} (${res.status})`);
  return nagerHolidaysSchema.parse(await res.json());
}

export async function fetchCountries(): Promise<{ countryCode: string; name: string }[]> {
  const res = await fetch(`${BASE}/AvailableCountries`);
  if (!res.ok) throw new Error(`Failed to fetch countries (${res.status})`);
  return countriesSchema.parse(await res.json());
}

export function filterHolidays(holidays: NagerHoliday[], stateCode?: string): ImportedHoliday[] {
  return holidays
    .filter((h) => h.global || (!!stateCode && (h.counties ?? []).includes(stateCode)))
    .map((h) => ({ name: h.name, date: h.date }));
}

export async function subdivisionsForCountry(countryCode: string, year: number): Promise<string[]> {
  const holidays = await fetchHolidays(countryCode, year);
  const codes = new Set<string>();
  for (const h of holidays) for (const c of h.counties ?? []) codes.add(c);
  return [...codes].sort();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/holidayImport.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/holidayImport.ts lib/holidayImport.test.ts
git commit -m "feat(holidays): add Nager.Date import module with state filtering"
```

---

### Task 3: Import input schema

**Files:**
- Modify: `lib/schemas/holiday.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `importHolidaysInput` Zod schema = `{ countryCode: string(len 2), stateCode?: string }`; `ImportHolidaysInput` type.

- [ ] **Step 1: Add the schema**

In `lib/schemas/holiday.ts`, append below the existing `holidayInput`:

```typescript
export const importHolidaysInput = z.object({
  countryCode: z.string().length(2),
  stateCode: z.string().optional(),
});

export type ImportHolidaysInput = z.infer<typeof importHolidaysInput>;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/schemas/holiday.ts
git commit -m "feat(holidays): add importHolidaysInput schema"
```

---

### Task 4: Router — `availableCountries`, `subdivisions`, `import`

**Files:**
- Modify: `server/routers/holiday.ts`

**Interfaces:**
- Consumes: `fetchCountries`, `subdivisionsForCountry`, `fetchHolidays`, `filterHolidays` from `@/lib/holidayImport`; `importHolidaysInput` from `@/lib/schemas`.
- Produces: tRPC procedures `holiday.availableCountries` (query), `holiday.subdivisions` (query, input `{ countryCode }`), `holiday.import` (mutation, input `importHolidaysInput`) returning `{ imported: number; updated: number }`. `holiday.create` now sets `source: "CUSTOM"`.

- [ ] **Step 1: Update imports and `create`**

In `server/routers/holiday.ts`, replace the import line and the `create` procedure.

Top imports become:

```typescript
import { z } from "zod";
import { router, accountProcedure } from "../trpc";
import { assertCan } from "../permissions";
import { holidayInput, importHolidaysInput } from "@/lib/schemas";
import { fetchCountries, subdivisionsForCountry, fetchHolidays, filterHolidays } from "@/lib/holidayImport";
```

Change `create` to set source explicitly:

```typescript
  create: accountProcedure.input(holidayInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    const { accountId: _a, ...rest } = input as typeof input & { accountId: string };
    return ctx.prisma.holiday.create({ data: { ...rest, accountId: ctx.account.id, source: "CUSTOM" } });
  }),
```

- [ ] **Step 2: Add the three new procedures**

Add these inside the `router({ ... })`, after `delete`:

```typescript
  availableCountries: accountProcedure.query(() => fetchCountries()),

  subdivisions: accountProcedure
    .input(z.object({ countryCode: z.string().length(2) }))
    .query(({ input }) => subdivisionsForCountry(input.countryCode, new Date().getFullYear())),

  import: accountProcedure.input(importHolidaysInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    const year = new Date().getFullYear();
    const holidays = filterHolidays(await fetchHolidays(input.countryCode, year), input.stateCode);

    let imported = 0;
    let updated = 0;
    await ctx.prisma.$transaction(async (tx) => {
      for (const h of holidays) {
        const existing = await tx.holiday.findUnique({
          where: { accountId_name_source: { accountId: ctx.account.id, name: h.name, source: "IMPORTED" } },
        });
        if (existing) updated++; else imported++;
        await tx.holiday.upsert({
          where: { accountId_name_source: { accountId: ctx.account.id, name: h.name, source: "IMPORTED" } },
          create: { accountId: ctx.account.id, name: h.name, date: new Date(h.date), isRecurring: true, source: "IMPORTED" },
          update: { date: new Date(h.date), isRecurring: true },
        });
      }
    });
    return { imported, updated };
  }),
```

Note: `accountId_name_source` is the Prisma compound-unique accessor generated from `@@unique([accountId, name, source])`. If `npm run db:push` named it differently, use the name Prisma generated (check the generated client types via `npm run typecheck`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If the compound key accessor name is wrong, the error will name the expected key — fix and re-run.

- [ ] **Step 4: Run the full test suite (no regressions)**

Run: `npx vitest run`
Expected: PASS (existing tests unaffected; no new router test — router stays thin, logic is covered in Task 2).

- [ ] **Step 5: Commit**

```bash
git add server/routers/holiday.ts
git commit -m "feat(holidays): add country/subdivision/import procedures"
```

---

### Task 5: UI — import panel and source badges

**Files:**
- Modify: `app/holidays/page.tsx`

**Interfaces:**
- Consumes: `trpc.holiday.availableCountries`, `trpc.holiday.subdivisions`, `trpc.holiday.import`; existing `trpc.holiday.list` now returns `source`.

- [ ] **Step 1: Add import state, queries, and mutation**

In `app/holidays/page.tsx`, after the existing `del` mutation and `useState` lines, add:

```tsx
  const [country, setCountry] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const { data: countries } = trpc.holiday.availableCountries.useQuery(
    { accountId: accountId! }, { enabled: !!accountId },
  );
  const { data: subdivisions } = trpc.holiday.subdivisions.useQuery(
    { accountId: accountId!, countryCode: country },
    { enabled: !!accountId && country.length === 2 },
  );
  const importHolidays = trpc.holiday.import.useMutation({
    onSuccess: (r) => {
      setImportMsg(`Imported ${r.imported}, updated ${r.updated}.`);
      utils.holiday.list.invalidate(); utils.forecast.getData.invalidate();
    },
    onError: (e) => setImportMsg(`Import failed: ${e.message}`),
  });
```

When `country` changes, reset the state selection. Add an `onChange` that does `setCountry(v); setStateCode("");`.

- [ ] **Step 2: Add the import panel markup**

Add this block inside the `<div className="space-y-4">`, directly under the `<h1>`:

```tsx
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1 text-sm">
            <span>Country</span>
            <select className="rounded-md border px-2 py-1" value={country}
              onChange={(e) => { setCountry(e.target.value); setStateCode(""); }}>
              <option value="">Select…</option>
              {(countries ?? []).map((c) => (
                <option key={c.countryCode} value={c.countryCode}>{c.name}</option>
              ))}
            </select>
          </div>
          {(subdivisions ?? []).length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <span>State (optional)</span>
              <select className="rounded-md border px-2 py-1" value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}>
                <option value="">National only</option>
                {(subdivisions ?? []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <Button size="sm" disabled={!canEditHolidays || country.length !== 2 || importHolidays.isPending}
            onClick={() => { setImportMsg(null); importHolidays.mutate({ accountId: accountId!, countryCode: country, stateCode: stateCode || undefined }); }}>
            {importHolidays.isPending ? "Importing…" : "Import holidays"}
          </Button>
          {importMsg && <span className="text-sm text-muted-foreground">{importMsg}</span>}
        </div>
```

(Plain `<select>` is used to match the existing lightweight form; the Radix `Select` component is available if preferred, but not required.)

- [ ] **Step 3: Add source badge to list rows**

In the list `.map((h) => ...)`, change the `<span>` to show a badge:

```tsx
            <span>
              {h.name} — {format(new Date(h.date), "MMM d, yyyy")}{h.isRecurring ? " (yearly)" : ""}
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {h.source === "IMPORTED" ? "Imported" : "Custom"}
              </span>
            </span>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual verification**

Dev server is already running (do not start it; check `dev.log` if needed). In the app, open Holidays, pick a country (e.g. Australia), optionally a state, click Import. Expected: list populates with `Imported` badges; clicking Import again shows "updated" counts and no duplicates.

- [ ] **Step 6: Commit**

```bash
git add app/holidays/page.tsx
git commit -m "feat(holidays): add location import panel and source badges"
```

---

## Self-Review

**Spec coverage:**
- Data source / endpoints → Task 2 (`fetchHolidays`, `fetchCountries`). ✓
- Subdivision derivation → Task 2 (`subdivisionsForCountry`). ✓
- Schema `source` + dedup key + non-destructive push → Task 1. ✓
- State filtering rule (national OR selected state) → Task 2 (`filterHolidays`) + tests. ✓
- `importHolidaysInput`, current-year server-side → Task 3 + Task 4. ✓
- Router `availableCountries` / `subdivisions` / `import` with upsert-by-`(name,source=IMPORTED)`, `isRecurring:true`, CUSTOM untouched, permission gate → Task 4. ✓
- `create` defaults `source: CUSTOM` → Task 4. ✓
- Forecast/engine unchanged → no task modifies them. ✓
- UI import panel + badges + re-import → Task 5. ✓
- Tests: parse, filter by state, distinct subdivisions, non-200 error → Task 2. Idempotent re-import / date correction is enforced by the upsert-by-`(name,source)` design and verified manually in Task 5 Step 5 (repo has no tRPC caller harness; per conventions logic lives in tested pure helpers). ✓

**Placeholder scan:** none — every code step has full code; commands have expected output.

**Type consistency:** `NagerHoliday`, `ImportedHoliday`, `filterHolidays`, `fetchHolidays`, `subdivisionsForCountry`, `fetchCountries`, `importHolidaysInput` names match across Tasks 2–5. Compound-key accessor `accountId_name_source` matches `@@unique([accountId, name, source])` from Task 1 (with a note to verify the generated name).
