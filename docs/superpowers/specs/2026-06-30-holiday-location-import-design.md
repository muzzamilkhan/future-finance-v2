# Holiday Location-Based Import — Design

**Date:** 2026-06-30
**Status:** Approved

## Goal

Let users populate an account's holidays by importing public holidays for a
chosen country (and optional state/subdivision), instead of entering every
holiday by hand. Re-importing refreshes the set: it corrects dates for moving
holidays (e.g. Easter) in place and never creates duplicates. Imported holidays
are distinguished from manually-entered ones.

Holidays remain **account-scoped** (unchanged from today). No global/per-user
refactor.

## Data source

[Nager.Date](https://date.nager.at) — free, open-source, no API key, no proxy,
100+ countries.

- Holidays: `GET https://date.nager.at/api/v3/PublicHolidays/{year}/{countryCode}`
- Countries: `GET https://date.nager.at/api/v3/AvailableCountries`

Each holiday object includes: `date`, `localName`, `name`, `countryCode`,
`global` (bool), `counties` (array of subdivision codes like `["AU-WA"]` or
`null`), `types`.

**Subdivisions:** Nager has no dedicated "list subdivisions" endpoint. We derive
the state dropdown by fetching a country's holidays once and collecting the
distinct `counties` codes. Display the ISO code (e.g. `AU-NSW`); a human-readable
name is not reliably available, so the code is acceptable.

## Schema changes

Holiday stays account-scoped. Add a `source` discriminator; change the dedup key.

```prisma
enum HolidaySource {
  IMPORTED
  CUSTOM
}

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

- **Add** `source` (default `CUSTOM`).
- **Change** unique constraint `@@unique([accountId, date])` →
  `@@unique([accountId, name, source])`.
  - Rationale: re-import corrects a moving holiday's date in place, so `date`
    cannot be the dedup key. `(name, source)` is stable across years.
  - An IMPORTED and a CUSTOM holiday may share a name within one account (different
    source namespace).
- **Migration is non-destructive.** Existing rows get `source = CUSTOM`. The new
  unique key is broader than the old one in practice (name+source vs date); if any
  legacy account somehow holds two holidays with the same name+source the migration
  would fail — acceptable given current data is effectively test data, but the
  migration should be reviewed against existing rows before applying.

## State / subdivision handling

Countries like Australia and the US have state-specific holidays. Nager marks
these with `global: false` and a `counties` array. Importing *all* of them would
merge every state's holidays (e.g. multiple "Labour Day" rows on different dates),
which collide under the `(name, source)` dedup key.

**Approach: country + optional state.**

- User picks a country, then optionally a state from a second dropdown.
- A holiday is included if:
  `global === true` **OR** (`stateCode` provided **AND** `counties?.includes(stateCode)`).
- If no state is selected: import national (`global`) holidays only.
- This avoids same-name collisions entirely because at most one state's variant of
  a given holiday is ever imported.

## Import service — `lib/holidayImport.ts`

Pure-ish module, no DB access (testable against mocked fetch):

- `fetchHolidays(countryCode: string, year: number): Promise<NagerHoliday[]>`
  - GET the PublicHolidays endpoint, Zod-validate the array, return parsed objects.
  - Throw a typed error on non-200 / unknown country.
- `fetchCountries(): Promise<{ countryCode: string; name: string }[]>`
  - GET AvailableCountries, Zod-validate. Cached in-memory (module-level, short TTL).
- `subdivisionsForCountry(countryCode, year): Promise<string[]>`
  - Calls `fetchHolidays`, returns the sorted distinct `counties` codes.
- `filterHolidays(holidays, stateCode?): { name: string; date: string }[]`
  - Applies the national-OR-state rule above and projects to `{ name, date }`.

Zod schema for a Nager holiday validates `date` (string), `name`, `global`
(boolean), `counties` (nullable string array).

## Schemas — `lib/schemas/holiday.ts`

- Keep `holidayInput` (manual create). Note `create` will default `source: CUSTOM`
  server-side.
- Add `importHolidaysInput = z.object({ countryCode: z.string().length(2), stateCode: z.string().optional() })`.
- Year is **not** an input — derived server-side as the current year.

## tRPC router — `server/routers/holiday.ts`

All procedures are `accountProcedure` (account-scoped) as today.

- `list` — unchanged (account-scoped, ordered by date). Returns `source` too.
- `create` — unchanged behavior; explicitly sets `source: CUSTOM`.
- `delete` — unchanged.
- `availableCountries` — query; returns `fetchCountries()`.
- `subdivisions` — query, input `{ countryCode }`; returns `subdivisionsForCountry(countryCode, currentYear)`.
- `import` — mutation, input `importHolidaysInput`:
  - `assertCan(ctx.membership, "editHolidays")`.
  - `const year = new Date().getFullYear()`.
  - `const holidays = filterHolidays(await fetchHolidays(countryCode, year), stateCode)`.
  - In a `ctx.prisma.$transaction`, for each holiday `upsert` on
    `(accountId, name, source = IMPORTED)`:
    - create: `{ accountId, name, date, isRecurring: true, source: IMPORTED }`
    - update: `{ date, isRecurring: true }` (corrects moving dates)
  - Track create vs update counts; return `{ imported, updated }`.
  - CUSTOM rows are never touched (different source namespace).

## Forecast / engine

**No changes.** Holidays remain account-scoped; `server/routers/forecast.ts`'s
holiday query is untouched. The engine (`lib/engine/dates.ts`, `instances.ts`,
`toEngine.ts`) already handles `isRecurring`. Re-import is the mechanism that keeps
moving-date holidays accurate year-over-year.

## UI — `app/holidays/page.tsx`

Add an **Import** panel above (or beside) the existing manual add-form:

- Country `<select>` populated from `holiday.availableCountries`.
- State `<select>` (optional), populated from `holiday.subdivisions` when a country
  with subdivisions is selected; hidden/empty otherwise.
- "Import holidays" button → `holiday.import`, then invalidate `holiday.list` and
  `forecast.getData`. Show resulting `{ imported, updated }` summary and any error.
- Disabled when `!canEditHolidays`.

List rows:
- Show a badge: `Imported` vs `Custom` (from `source`).
- Imported rows show a subtle "Re-import to refresh dates" hint; re-import is just
  clicking the Import button again with the same country/state.

Existing manual add-form and delete behavior unchanged (manual adds are `Custom`).

## Testing

- `lib/holidayImport.test.ts`
  - Parses a mocked Nager PublicHolidays response.
  - `filterHolidays`: national-only when no state; national + selected state when
    state given; excludes other states (no same-name collision).
  - `subdivisionsForCountry`: distinct, sorted county codes.
  - A second import with a shifted Easter date yields the corrected `{name,date}`
    (the upsert layer, tested at router level, updates in place).
- `server/routers/holiday.test.ts` (or extend existing router tests)
  - `import` then re-`import` is idempotent: same names → counted as updates, no
    new rows.
  - Re-import corrects a moving holiday's date.
  - A CUSTOM holiday sharing a name with an imported one is left untouched.
  - `editHolidays` permission enforced on `import`.
- Update any existing holiday tests for the new `source` field / unique key.

## Out of scope

- City-level granularity (Nager is country/subdivision-level only).
- Importing multiple years at once (current year only; re-import per year).
- Importing multiple countries into one account.
- Human-readable subdivision names (ISO codes shown).
