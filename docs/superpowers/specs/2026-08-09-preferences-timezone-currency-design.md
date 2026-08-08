# Preferences page: timezone + currency — design

**Date:** 2026-08-09
**Status:** Approved

## Summary

Add a `/preferences` page letting each user set their **timezone** and **currency**,
and detect sensible values for both on first authenticated load from the browser's
own locale settings.

Both settings are **user-level** (columns on `User`), not account-level. Timezone is
inherently personal, and on a shared account each member should still see the app in
their own zone. Currency follows the same scope for symmetry and simplicity.

The timezone preference **drives what counts as "today"** throughout the app — the
forecast window, the skip-today midnight reset, and date-field defaults — replacing
the current reliance on the device clock's local zone. The currency preference drives
all money formatting, and its derived locale drives date wording ("15 Jul" vs "Jul 15").

**Currency is a relabel, not a conversion.** No FX rates are involved.

## Motivation

Two hardcoded assumptions are currently baked into the app:

- `formatCurrency` in `lib/design-system.ts` is fixed to `en-AU` / `AUD`.
- "Today" is derived from the device's local calendar date in five places, so a user
  travelling (or with a misconfigured machine) sees their forecast start on the wrong
  day, and their "skip today" resets at the wrong midnight.

Neither is user-visible or adjustable today. This change makes both explicit,
per-user, and correct by default via detection.

## Data model changes

Two nullable columns on `User`:

```prisma
model User {
  // ...existing fields
  timeZone String?   // IANA zone, e.g. "Australia/Sydney"
  currency String?   // ISO 4217, e.g. "AUD"
}
```

**Nullable is deliberate.** `null` means "never detected" and is what triggers the
one-time detection; it is distinguishable from a user who deliberately *chose*
Australia/AUD. A schema-level default would erase that distinction and make
detection unable to tell new users from settled ones.

No backfill. Existing rows stay `null`, read through the fallbacks below, and get
detected on the user's next load. Nothing breaks mid-rollout.

**Fallbacks (single source of truth, `lib/preferences/defaults.ts`):**

```ts
export const DEFAULT_TIME_ZONE = "Australia/Sydney";
export const DEFAULT_CURRENCY = "AUD";
```

## New pure module: `lib/preferences/`

Per the repo convention that testable logic lives outside `.tsx`, all the real logic
sits here as pure functions with co-located Vitest tests. No React, no Prisma, no Next
imports.

### `calendarDateInZone(now: Date, timeZone: string): Date`

The load-bearing primitive. Returns UTC midnight of the calendar date it currently is
in `timeZone`.

```ts
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
}).format(now);                 // "2026-08-09"
const [y, m, d] = parts.split("-").map(Number);
return new Date(Date.UTC(y, m - 1, d));
```

`en-CA` is chosen because it formats as `YYYY-MM-DD`, making the parse trivial and
locale-independent. No date-fns involvement, so the DST hazard documented in CLAUDE.md
(date-fns `add*` operating on local wall-clock) does not apply.

**Tests must cover** the October AEDT transition, a negative-offset zone (`America/New_York`)
where the local date is *behind* UTC, and a positive-offset zone (`Pacific/Auckland`)
where it is *ahead* — the two cases the current device-clock code gets wrong.

### `formatCurrency(amount, currency, locale)`

Moved out of `lib/design-system.ts`, body otherwise unchanged (still
`Intl.NumberFormat` with 2 fraction digits). The existing three tests in
`lib/design-system.test.ts` move with it and gain explicit arguments.

`lib/design-system.ts` keeps `getAmountColorClass`, `getAmountBgClass`,
`MIN_TOUCH_TARGET`, and the two relative-time helpers.

### `currencyForCountry(countryCode): string`

A curated `country → currency` map (~40 entries covering the realistic user base),
falling back to `DEFAULT_CURRENCY` for anything unlisted. Pure and unit-tested.

### `localeForZone(timeZone): string`

Maps an IANA zone to a display locale (`Australia/Sydney` → `en-AU`,
`America/New_York` → `en-US`), falling back to `en-AU`. Used for both date wording
and currency formatting so the two stay consistent.

## Detection at signup

Client-side only. No external geolocation service, no IP handling, no hosting-specific
headers.

On first authenticated load, if `preferences.get` returns unset values, the provider reads:

```ts
const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();
// e.g. { timeZone: "Australia/Sydney", locale: "en-AU" }
```

- **Timezone** is used **verbatim** — it is already an IANA identifier, so no mapping
  table is needed at all.
- **Currency** is derived from the region subtag of `locale` (`en-AU` → `AU`) through
  `currencyForCountry`.

Deriving currency from the locale's region rather than from the timezone is what keeps
the mapping table small: a zone-based mapping would need ~400 entries, a region-based
one needs ~40.

It then calls `preferences.detect({ timeZone, currency })` once.

**`detect` is write-once, enforced server-side:** it only fills columns that are
currently `null`, in a single update with a `null` guard in the `where` clause. A
double-mount, a second tab, or a stale client can therefore never clobber a manual
choice. This is the only safety-critical rule in the feature.

## Server layer

New `preferences` router (`server/routers/preferences.ts`), registered in
`server/routers/_app.ts` alongside the existing seven. All three procedures are
`protectedProcedure` — these are user-scoped, not account-scoped, so `accountProcedure`
and its capability checks do not apply.

| Procedure | Input | Behaviour |
|---|---|---|
| `get` | — | Returns `{ timeZone, currency }` resolved against defaults, plus `isDetected` so the client knows whether to run detection. |
| `update` | `preferencesInput` | Sets either or both. Unconditional — this is the user's explicit choice. |
| `detect` | `preferencesInput` | Fills only columns currently `null`. Never overwrites. |

`preferencesInput` lives in `lib/schemas/` (Zod 4, matching the existing schema
convention): `timeZone` validated as a non-empty string accepted by
`Intl.supportedValuesOf("timeZone")`, `currency` as a 3-letter uppercase ISO code.
Both optional, at least one required.

**The forecast engine and its router need no timezone changes.** The client already
computes `viewStart`/`viewEnd` and passes them to `forecast.getCombined`, so the
preference changes only what the client *sends*. `lib/engine/` stays pure and
untouched, and the "engine never reads the clock" invariant holds.

## Client wiring

### `PreferencesProvider`

Sits alongside `AccountProvider` in the same tree (`app/providers.tsx`), backed by
`trpc.preferences.get` with a `staleTime` mirroring `AccountProvider`'s 30s. Exposes:

- `useFormatCurrency()` → `(amount: number) => string`, bound to the user's currency + locale
- `useToday()` → UTC midnight of the current date in the user's zone
- `usePreferences()` → the raw resolved values, for the page itself

It also owns the one-shot detection effect described above.

### Currency call sites

`formatCurrency` is called **~59 times across 18 files**, every one inside a
`"use client"` tree (verified: `app/spending/page.tsx` and `SpendingSummaryStats.tsx`
carry `"use client"` on line 2 / are imported by client parents). Each file gains one
`const fmt = useFormatCurrency()` line and its calls become `fmt(...)`.

No pure `.ts` helper and no server code calls `formatCurrency`, so there is no case
requiring the value to be threaded as a parameter.

A context + hook is used rather than module-level mutable state specifically because
`lib/design-system.ts` is shared across requests in a Next.js server process; a mutable
module-scoped currency would risk rendering one user's currency for another the moment
any RSC imported it, and would make tests order-dependent.

### "Today" call sites

These collapse to one choke point:

| Site | Change |
|---|---|
| `lib/dateInput.ts` `todayAsUtcDate(now, timeZone)` | Gains a zone param, delegates to `calendarDateInZone` |
| `app/particulars/page.tsx:35` | Passes the zone from `usePreferences()` |
| `ParticularForm.tsx:50`, `TransferForm.tsx:46`, `QuickAddRow.tsx:27` | Same |
| `app/_components/DashboardPage.tsx:33` | **Deleted** — it inlines the same computation; replaced by `useToday()` |

**Skip-today follows for free.** `DashboardPage.tsx:61` compares the stored
`skipTodayDate` against `today`; once `today` is zone-aware, the midnight reset is too,
with no change to that line. This preserves the CLAUDE.md invariant that skip-today
"resets at their local midnight" — it just makes "their local" mean the preference
rather than the device.

`app/debts/page.tsx:61`'s `new Date()` is an optimistic-update timestamp, not a
calendar date. Unchanged.

### Date wording

The five module-level `Intl.DateTimeFormat` instances in `lib/dateInput.ts` become
locale-keyed, memoised in a `Map<string, Intl.DateTimeFormat>` — constructing a
formatter per render is the one genuine performance trap in this change, and the daily
card list renders many of them.

**The UTC invariant is unchanged.** Every formatter keeps `timeZone: "UTC"`. Stored
dates remain UTC-midnight and the engine still compares in UTC; only the *word order*
becomes locale-driven. The user's timezone preference decides what "today" is; it does
**not** re-interpret stored dates.

`app/particulars/frequencyLabel.ts` is a pure, tested, non-React helper that calls
`formatUtcWeekdayLong`/`formatUtcWeekday`, so it cannot use a hook. It gains a `locale`
parameter, threaded from its single caller at `app/particulars/page.tsx:126`.

`lib/dateInput.test.ts` pins `en-US` explicitly on its existing assertions (e.g.
`toBe("Wednesday")`) so they keep asserting what they were written to assert.

### Relative-time fix

`isStale` and `getRelativeTime` in `lib/design-system.ts` compute day differences from
raw millisecond arithmetic, making their "Today"/"Yesterday" boundary effectively UTC.
For a Sydney user before 10am this labels a balance updated this morning as
"Yesterday". Both are changed to compare calendar dates via `calendarDateInZone` and
take a `timeZone` parameter, with tests covering the pre-10am Sydney case.

## The page

`/preferences`, a client page following the `/holidays` and `/accounts` structure
(`Layout` wrapper, shadcn `Card`, `Select` fields):

- **Timezone** — options from `Intl.supportedValuesOf("timeZone")`, searchable.
- **Currency** — the curated list, plus the user's stored value if it is not in it, so
  a manually-set exotic currency is never silently dropped.
- **Live preview** — one line reading e.g. `Balances show as $1,234.56 · Today is Sun, 9 Aug 2026`,
  rendered from the *pending* selection so the effect is visible before saving.
- **Helper text under currency** — states plainly that changing currency relabels
  existing amounts and does not convert them. This is the most likely way for a user to
  lose trust in their numbers, so it is called out at the point of change.

Saves go through `preferences.update` with optimistic updates via the existing
`lib/optimistic.ts` helpers, and a Sonner toast on success, matching the other pages.

Nav entry (`Settings` icon from lucide) added to **both** `app/_components/Sidebar.tsx`
and `app/_components/BottomNav.tsx` — the two nav lists are maintained separately.

## Testing

Per CLAUDE.md: pure-function Vitest only, no UI or integration scaffolding.

- `lib/preferences/calendarDateInZone.test.ts` — DST transition, negative-offset zone,
  positive-offset zone, and zone-vs-UTC disagreement at the day boundary
- `lib/preferences/currencyForCountry.test.ts` — known regions, unknown fallback
- `lib/preferences/localeForZone.test.ts` — known zones, unknown fallback
- `lib/preferences/formatCurrency.test.ts` — the three migrated cases, plus a
  non-AUD currency
- `lib/dateInput.test.ts` — updated for explicit locale; new cases for locale-driven
  wording
- `app/particulars/frequencyLabel.test.ts` — updated for the new `locale` param
- `lib/design-system.test.ts` — new zone-aware `isStale`/`getRelativeTime` cases

## Out of scope

- **FX conversion.** Amounts are stored as bare numbers; currency is presentation only.
- **Per-account currency.** Deliberately rejected in favour of user-level scope.
- **Locale-driven number input parsing.** `parseNumericInput` already strips currency
  text loosely and needs no change.
- **`holiday.subdivisions` / `holiday.import`** use server-side `new Date().getFullYear()`,
  which is wrong only for a few hours around New Year. Unrelated to this request;
  left alone.
