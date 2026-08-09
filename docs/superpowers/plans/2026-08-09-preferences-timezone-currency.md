# Preferences Page (Timezone + Currency) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user set their timezone and currency on a `/preferences` page, detect both from the browser on first load, and make those settings drive money formatting, date wording, and what counts as "today".

**Architecture:** All logic lives as pure, unit-tested functions in a new `lib/preferences/` module. A `PreferencesProvider` (React context, backed by a tRPC query) exposes `useFormatCurrency()`, `useToday()`, and `usePreferences()` to client components. Preferences are two nullable columns on `User`; `null` means "never detected" and triggers a write-once detection call. The forecast engine is not touched — the client already computes and sends `viewStart`/`viewEnd`, so making the client zone-aware is sufficient.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · tRPC 11 · Prisma 7 · PostgreSQL · Zod 4 · Vitest 4 · Tailwind v4 · Radix/shadcn · Sonner

## Global Constraints

- **Work directly on `main`.** Never create a branch or worktree.
- **Tests are pure-function Vitest only.** No UI, integration, or Playwright tests. Cover `lib/` and co-located `*.ts` helpers.
- **Do not run the dev server to verify.** Make the change, run `npm test` / `npm run typecheck`, and say it's done.
- **Commit when a unit of work is done.** Stage only files you changed.
- `lib/engine/` and `lib/schemas/` must stay free of React, Prisma, and Next imports. `lib/preferences/` follows the same rule.
- **All stored dates are UTC midnight and compared in UTC.** This plan does not change that. The timezone preference decides *what today is*; it never re-interprets a stored date. Every `Intl.DateTimeFormat` in `lib/dateInput.ts` keeps `timeZone: "UTC"`.
- Do not use date-fns `add*`/`isSameDay` on UTC-midnight dates — use the `addUtcDays`/`addUtcMonths`/`addUtcYears` helpers in `lib/engine/dates.ts`.
- Path alias is `@/*` → repo root.
- Default fallbacks, used verbatim everywhere: `DEFAULT_TIME_ZONE = "Australia/Sydney"`, `DEFAULT_CURRENCY = "AUD"`, `DEFAULT_LOCALE = "en-AU"`.
- Test commands: `npx vitest run <path>` for one file, `npm test -- --run` for all, `npm run typecheck` for types.

## File Structure

**Create:**
| File | Responsibility |
|---|---|
| `lib/preferences/defaults.ts` | The three default constants. No logic. |
| `lib/preferences/calendarDateInZone.ts` | `calendarDateInZone(now, timeZone)` — UTC midnight of the calendar date in a zone. |
| `lib/preferences/currencyForCountry.ts` | `currencyForCountry(code)` + `CURRENCY_OPTIONS` list for the page. |
| `lib/preferences/localeForZone.ts` | `localeForZone(timeZone)` — IANA zone → display locale. |
| `lib/preferences/formatCurrency.ts` | `formatCurrency(amount, currency, locale)`, moved out of design-system. |
| `lib/preferences/resolve.ts` | `resolvePreferences(row)` — applies defaults, derives locale, reports `isDetected`. |
| `lib/preferences/detect.ts` | `detectFromResolvedOptions(opts)` — browser Intl output → `{timeZone, currency}`. |
| `lib/preferences/index.ts` | Re-exports. |
| `lib/schemas/preferences.ts` | `preferencesInput` Zod schema. |
| `server/routers/preferences.ts` | `preferencesRouter` — `get` / `update` / `detect`. |
| `app/_components/PreferencesContext.tsx` | Provider + `usePreferences` / `useFormatCurrency` / `useToday`. |
| `app/preferences/page.tsx` | The page. |
| `prisma/migrations/20260809000000_user_preferences/migration.sql` | Adds the two columns. |

Each pure file above gets a co-located `*.test.ts`.

**Modify:** `prisma/schema.prisma` · `lib/schemas/index.ts` · `server/routers/_app.ts` · `lib/design-system.ts` (+ its test) · `lib/dateInput.ts` (+ its test) · `app/particulars/frequencyLabel.ts` (+ its test) · `app/providers.tsx` · `app/_components/Sidebar.tsx` · `app/_components/BottomNav.tsx` · the 17 currency call-site files · the 5 "today" call-site files.

---

### Task 1: `calendarDateInZone` — the core primitive

This is the load-bearing function: it answers "what calendar date is it right now in zone X", returned as UTC midnight so it drops straight into the engine's UTC-keyed world.

**Files:**
- Create: `lib/preferences/defaults.ts`
- Create: `lib/preferences/calendarDateInZone.ts`
- Test: `lib/preferences/calendarDateInZone.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `calendarDateInZone(now: Date, timeZone: string): Date` · `DEFAULT_TIME_ZONE`, `DEFAULT_CURRENCY`, `DEFAULT_LOCALE` (all `string`)

- [ ] **Step 1: Write the failing test**

Create `lib/preferences/calendarDateInZone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { calendarDateInZone } from "./calendarDateInZone";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("calendarDateInZone", () => {
  it("returns UTC midnight of the local calendar date", () => {
    // 2026-08-09 04:00 UTC is 2026-08-09 14:00 in Sydney (UTC+10).
    expect(calendarDateInZone(new Date("2026-08-09T04:00:00Z"), "Australia/Sydney"))
      .toEqual(utc(2026, 8, 9));
  });

  it("is a day AHEAD of UTC for a positive-offset zone late in the UTC day", () => {
    // 2026-08-09 20:00 UTC is already 2026-08-10 06:00 in Sydney.
    expect(calendarDateInZone(new Date("2026-08-09T20:00:00Z"), "Australia/Sydney"))
      .toEqual(utc(2026, 8, 10));
  });

  it("is a day BEHIND UTC for a negative-offset zone early in the UTC day", () => {
    // 2026-08-09 02:00 UTC is still 2026-08-08 22:00 in New York (UTC-4).
    expect(calendarDateInZone(new Date("2026-08-09T02:00:00Z"), "America/New_York"))
      .toEqual(utc(2026, 8, 8));
  });

  it("handles the Sydney DST start (AEST->AEDT, first Sunday of October)", () => {
    // 2026-10-04 02:00 local: clocks jump 2am -> 3am. 15:30 UTC on 10-03 is
    // 2026-10-04 02:30 AEDT, i.e. already the 4th locally.
    expect(calendarDateInZone(new Date("2026-10-03T15:30:00Z"), "Australia/Sydney"))
      .toEqual(utc(2026, 10, 4));
  });

  it("handles the Sydney DST end (AEDT->AEST, first Sunday of April)", () => {
    // 2026-04-05 13:00 UTC is 2026-04-05 23:00 AEST (offset back to +10).
    expect(calendarDateInZone(new Date("2026-04-05T13:00:00Z"), "Australia/Sydney"))
      .toEqual(utc(2026, 4, 5));
  });

  it("returns a UTC-midnight instant (no time component)", () => {
    const d = calendarDateInZone(new Date("2026-08-09T13:45:12Z"), "Australia/Sydney");
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  it("falls back to the default zone when given an invalid zone", () => {
    expect(calendarDateInZone(new Date("2026-08-09T04:00:00Z"), "Not/AZone"))
      .toEqual(utc(2026, 8, 9));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/preferences/calendarDateInZone.test.ts`
Expected: FAIL — cannot resolve `./calendarDateInZone`.

- [ ] **Step 3: Write the implementation**

Create `lib/preferences/defaults.ts`:

```ts
// Single source of truth for what an undetected / unset preference falls back to.
export const DEFAULT_TIME_ZONE = "Australia/Sydney";
export const DEFAULT_CURRENCY = "AUD";
export const DEFAULT_LOCALE = "en-AU";
```

Create `lib/preferences/calendarDateInZone.ts`:

```ts
import { DEFAULT_TIME_ZONE } from "./defaults";

// Formatters are expensive to construct, and this runs on every render that asks
// for "today". Cache one per zone.
const cache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const hit = cache.get(timeZone);
  if (hit) return hit;
  let fmt: Intl.DateTimeFormat;
  try {
    // en-CA renders as YYYY-MM-DD, which makes the parse below trivial and
    // independent of the caller's locale.
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    // Invalid IANA zone (stale stored value, hand-edited DB row) — don't explode
    // the whole dashboard over a bad string.
    fmt = formatterFor(DEFAULT_TIME_ZONE);
  }
  cache.set(timeZone, fmt);
  return fmt;
}

/**
 * UTC midnight of the calendar date it currently is in `timeZone`.
 *
 * The engine keys every day by its UTC components, so "today" must be expressed as
 * UTC midnight of the user's local calendar date — not as a local-midnight instant,
 * which would land on the wrong UTC day for any non-zero offset. Deliberately avoids
 * date-fns, whose add*/startOfDay helpers work on local wall-clock time and shift
 * UTC-midnight dates across a DST boundary (see CLAUDE.md).
 */
export function calendarDateInZone(now: Date, timeZone: string): Date {
  const [y, m, d] = formatterFor(timeZone).format(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/preferences/calendarDateInZone.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/preferences/defaults.ts lib/preferences/calendarDateInZone.ts lib/preferences/calendarDateInZone.test.ts
git commit -m "Add calendarDateInZone: UTC midnight of a zone's calendar date"
```

---

### Task 2: Currency and locale lookup tables

**Files:**
- Create: `lib/preferences/currencyForCountry.ts`
- Create: `lib/preferences/localeForZone.ts`
- Test: `lib/preferences/currencyForCountry.test.ts`, `lib/preferences/localeForZone.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_CURRENCY`, `DEFAULT_LOCALE` from `./defaults`
- Produces: `currencyForCountry(countryCode: string | undefined): string` · `localeForZone(timeZone: string): string` · `CURRENCY_OPTIONS: { code: string; label: string }[]`

- [ ] **Step 1: Write the failing tests**

Create `lib/preferences/currencyForCountry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { currencyForCountry, CURRENCY_OPTIONS } from "./currencyForCountry";

describe("currencyForCountry", () => {
  it("maps known regions to their currency", () => {
    expect(currencyForCountry("AU")).toBe("AUD");
    expect(currencyForCountry("NZ")).toBe("NZD");
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry("GB")).toBe("GBP");
    expect(currencyForCountry("DE")).toBe("EUR");
  });

  it("is case-insensitive", () => {
    expect(currencyForCountry("au")).toBe("AUD");
  });

  it("falls back to the default for unknown or missing regions", () => {
    expect(currencyForCountry("ZZ")).toBe("AUD");
    expect(currencyForCountry(undefined)).toBe("AUD");
    expect(currencyForCountry("")).toBe("AUD");
  });
});

describe("CURRENCY_OPTIONS", () => {
  it("has no duplicate codes", () => {
    const codes = CURRENCY_OPTIONS.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes the default currency", () => {
    expect(CURRENCY_OPTIONS.some((o) => o.code === "AUD")).toBe(true);
  });

  it("uses 3-letter uppercase ISO codes", () => {
    for (const o of CURRENCY_OPTIONS) expect(o.code).toMatch(/^[A-Z]{3}$/);
  });
});
```

Create `lib/preferences/localeForZone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { localeForZone } from "./localeForZone";

describe("localeForZone", () => {
  it("maps Australian zones to en-AU", () => {
    expect(localeForZone("Australia/Sydney")).toBe("en-AU");
    expect(localeForZone("Australia/Perth")).toBe("en-AU");
  });

  it("maps US zones to en-US", () => {
    expect(localeForZone("America/New_York")).toBe("en-US");
    expect(localeForZone("America/Los_Angeles")).toBe("en-US");
  });

  it("maps other known regions", () => {
    expect(localeForZone("Pacific/Auckland")).toBe("en-NZ");
    expect(localeForZone("Europe/London")).toBe("en-GB");
  });

  it("falls back to the default locale for unknown zones", () => {
    expect(localeForZone("Not/AZone")).toBe("en-AU");
    expect(localeForZone("")).toBe("en-AU");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/preferences/currencyForCountry.test.ts lib/preferences/localeForZone.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

Create `lib/preferences/currencyForCountry.ts`:

```ts
import { DEFAULT_CURRENCY } from "./defaults";

// Curated rather than exhaustive. Currency is derived from the browser locale's
// REGION subtag (en-AU -> AU), which needs ~40 entries; deriving it from the IANA
// timezone instead would need a ~400-entry table for no extra accuracy.
const BY_COUNTRY: Record<string, string> = {
  AU: "AUD", NZ: "NZD", US: "USD", CA: "CAD", GB: "GBP", IE: "EUR",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR",
  AT: "EUR", PT: "EUR", FI: "EUR", GR: "EUR", CH: "CHF", NO: "NOK",
  SE: "SEK", DK: "DKK", PL: "PLN", CZ: "CZK", JP: "JPY", CN: "CNY",
  HK: "HKD", SG: "SGD", MY: "MYR", ID: "IDR", TH: "THB", PH: "PHP",
  VN: "VND", IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", AE: "AED",
  SA: "SAR", IL: "ILS", TR: "TRY", ZA: "ZAR", NG: "NGN", KE: "KES",
  EG: "EGP", BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP",
  KR: "KRW", TW: "TWD", FJ: "FJD", PG: "PGK",
};

/** ISO 4217 currency for a 2-letter region code, defaulting when unknown. */
export function currencyForCountry(countryCode: string | undefined): string {
  if (!countryCode) return DEFAULT_CURRENCY;
  return BY_COUNTRY[countryCode.toUpperCase()] ?? DEFAULT_CURRENCY;
}

/** Currencies offered on the preferences page, in rough order of likely use. */
export const CURRENCY_OPTIONS: { code: string; label: string }[] = [
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "NZD", label: "NZD — New Zealand Dollar" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
  { code: "HKD", label: "HKD — Hong Kong Dollar" },
  { code: "JPY", label: "JPY — Japanese Yen" },
  { code: "CNY", label: "CNY — Chinese Yuan" },
  { code: "INR", label: "INR — Indian Rupee" },
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "SEK", label: "SEK — Swedish Krona" },
  { code: "NOK", label: "NOK — Norwegian Krone" },
  { code: "DKK", label: "DKK — Danish Krone" },
  { code: "ZAR", label: "ZAR — South African Rand" },
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "BRL", label: "BRL — Brazilian Real" },
  { code: "MXN", label: "MXN — Mexican Peso" },
  { code: "KRW", label: "KRW — South Korean Won" },
];
```

Create `lib/preferences/localeForZone.ts`:

```ts
import { DEFAULT_LOCALE } from "./defaults";

// Drives BOTH date wording ("15 Jul" vs "Jul 15") and currency symbol placement, so
// the two always agree. Keyed on the zone's region prefix, with specific-zone
// overrides where a region spans locales.
const BY_ZONE: Record<string, string> = {
  "Pacific/Auckland": "en-NZ",
  "Europe/London": "en-GB",
  "Europe/Dublin": "en-IE",
  "Asia/Singapore": "en-SG",
  "Asia/Hong_Kong": "en-HK",
  "Asia/Tokyo": "ja-JP",
  "Asia/Kolkata": "en-IN",
  "Africa/Johannesburg": "en-ZA",
};

const BY_PREFIX: Record<string, string> = {
  Australia: "en-AU",
  America: "en-US",
  Europe: "en-GB",
  Pacific: "en-AU",
};

/** Display locale for an IANA timezone, defaulting when unknown. */
export function localeForZone(timeZone: string): string {
  if (!timeZone) return DEFAULT_LOCALE;
  const exact = BY_ZONE[timeZone];
  if (exact) return exact;
  const prefix = timeZone.split("/")[0];
  return BY_PREFIX[prefix] ?? DEFAULT_LOCALE;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/preferences/currencyForCountry.test.ts lib/preferences/localeForZone.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/preferences/currencyForCountry.ts lib/preferences/currencyForCountry.test.ts lib/preferences/localeForZone.ts lib/preferences/localeForZone.test.ts
git commit -m "Add currency-by-region and locale-by-zone lookup tables"
```

---

### Task 3: Move `formatCurrency` into `lib/preferences/`

`lib/design-system.ts` currently hardcodes `en-AU`/`AUD`. Move the function out, give it parameters, and re-export from the old location so this task compiles on its own without touching all 17 call sites (Task 10 does those).

**Files:**
- Create: `lib/preferences/formatCurrency.ts`, `lib/preferences/resolve.ts`, `lib/preferences/detect.ts`, `lib/preferences/index.ts`
- Test: `lib/preferences/formatCurrency.test.ts`, `lib/preferences/resolve.test.ts`, `lib/preferences/detect.test.ts`
- Modify: `lib/design-system.ts:1-8`, `lib/design-system.test.ts:1-8`

**Interfaces:**
- Consumes: `DEFAULT_*` from `./defaults`, `currencyForCountry`, `localeForZone`
- Produces:
  - `formatCurrency(amount: number, currency?: string, locale?: string): string`
  - `resolvePreferences(row: { timeZone: string | null; currency: string | null }): { timeZone: string; currency: string; locale: string; isDetected: boolean }`
  - `detectFromResolvedOptions(opts: { timeZone?: string; locale?: string }): { timeZone: string; currency: string }`

- [ ] **Step 1: Write the failing tests**

Create `lib/preferences/formatCurrency.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCurrency } from "./formatCurrency";

describe("formatCurrency", () => {
  it("defaults to AUD in en-AU", () => {
    expect(formatCurrency(1500)).toBe("$1,500.00");
  });

  it("always shows exactly two decimals", () => {
    expect(formatCurrency(1500.5)).toBe("$1,500.50");
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats negatives", () => {
    expect(formatCurrency(-42.25)).toBe("-$42.25");
  });

  it("honours an explicit currency and locale", () => {
    expect(formatCurrency(1500, "USD", "en-US")).toBe("$1,500.00");
    expect(formatCurrency(1500, "GBP", "en-GB")).toBe("£1,500.00");
  });

  it("falls back to defaults when handed an invalid currency code", () => {
    expect(formatCurrency(1500, "not-a-code", "en-AU")).toBe("$1,500.00");
  });
});
```

Create `lib/preferences/resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolvePreferences } from "./resolve";

describe("resolvePreferences", () => {
  it("applies defaults when nothing is stored", () => {
    expect(resolvePreferences({ timeZone: null, currency: null }))
      .toEqual({ timeZone: "Australia/Sydney", currency: "AUD", locale: "en-AU", isDetected: false });
  });

  it("reports isDetected false when only one column is set", () => {
    expect(resolvePreferences({ timeZone: "America/New_York", currency: null }).isDetected).toBe(false);
  });

  it("uses stored values and derives locale from the zone", () => {
    expect(resolvePreferences({ timeZone: "America/New_York", currency: "USD" }))
      .toEqual({ timeZone: "America/New_York", currency: "USD", locale: "en-US", isDetected: true });
  });

  it("keeps a currency that disagrees with the zone (user's explicit choice wins)", () => {
    const r = resolvePreferences({ timeZone: "Australia/Sydney", currency: "JPY" });
    expect(r.currency).toBe("JPY");
    expect(r.locale).toBe("en-AU");
  });
});
```

Create `lib/preferences/detect.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectFromResolvedOptions } from "./detect";

describe("detectFromResolvedOptions", () => {
  it("uses the IANA zone verbatim and derives currency from the locale region", () => {
    expect(detectFromResolvedOptions({ timeZone: "Australia/Sydney", locale: "en-AU" }))
      .toEqual({ timeZone: "Australia/Sydney", currency: "AUD" });
  });

  it("handles a US browser", () => {
    expect(detectFromResolvedOptions({ timeZone: "America/New_York", locale: "en-US" }))
      .toEqual({ timeZone: "America/New_York", currency: "USD" });
  });

  it("reads the region from a script-tagged locale", () => {
    expect(detectFromResolvedOptions({ timeZone: "Asia/Shanghai", locale: "zh-Hans-CN" }).currency)
      .toBe("CNY");
  });

  it("falls back to the default currency when the locale has no region", () => {
    expect(detectFromResolvedOptions({ timeZone: "Europe/London", locale: "en" }))
      .toEqual({ timeZone: "Europe/London", currency: "AUD" });
  });

  it("falls back to the default zone when the browser reports nothing", () => {
    expect(detectFromResolvedOptions({}))
      .toEqual({ timeZone: "Australia/Sydney", currency: "AUD" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/preferences/formatCurrency.test.ts lib/preferences/resolve.test.ts lib/preferences/detect.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

Create `lib/preferences/formatCurrency.ts`:

```ts
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from "./defaults";

const cache = new Map<string, Intl.NumberFormat>();

/**
 * Money formatting. Kept pure and parameterised (rather than reading a module-level
 * "current currency") because this module is shared across requests in the Next.js
 * server process — mutable module state could render one user's currency for another.
 * Components get a bound version via useFormatCurrency().
 */
export function formatCurrency(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const key = `${locale}:${currency}`;
  let fmt = cache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(locale, {
        style: "currency", currency,
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    } catch {
      // Bad stored code — fall back rather than break every balance on the page.
      fmt = new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: "currency", currency: DEFAULT_CURRENCY,
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    }
    cache.set(key, fmt);
  }
  return fmt.format(amount);
}
```

Create `lib/preferences/resolve.ts`:

```ts
import { DEFAULT_CURRENCY, DEFAULT_TIME_ZONE } from "./defaults";
import { localeForZone } from "./localeForZone";

export type StoredPreferences = { timeZone: string | null; currency: string | null };
export type ResolvedPreferences = {
  timeZone: string; currency: string; locale: string; isDetected: boolean;
};

/**
 * Apply defaults to the stored row. `isDetected` is false unless BOTH columns are
 * set — that's what tells the client to run one-time browser detection. A partially
 * filled row is treated as undetected so the missing half still gets filled in.
 */
export function resolvePreferences(row: StoredPreferences): ResolvedPreferences {
  const timeZone = row.timeZone ?? DEFAULT_TIME_ZONE;
  return {
    timeZone,
    currency: row.currency ?? DEFAULT_CURRENCY,
    locale: localeForZone(timeZone),
    isDetected: row.timeZone !== null && row.currency !== null,
  };
}
```

Create `lib/preferences/detect.ts`:

```ts
import { DEFAULT_TIME_ZONE } from "./defaults";
import { currencyForCountry } from "./currencyForCountry";

/**
 * Turn `Intl.DateTimeFormat().resolvedOptions()` into stored preferences.
 * The timezone is already an IANA identifier so it needs no mapping; the currency
 * comes from the locale's region subtag (en-AU -> AU -> AUD).
 */
export function detectFromResolvedOptions(
  opts: { timeZone?: string; locale?: string },
): { timeZone: string; currency: string } {
  // Read the region subtag WITHOUT maximize(): `Intl.Locale("zh-Hans-CN").region`
  // is already "CN", while a bare "en" correctly yields undefined. Calling
  // maximize() would expand "en" to "en-Latn-US" and hand an English-speaking
  // user in an unknown country USD, which is a worse guess than the default.
  let region: string | undefined;
  try {
    region = opts.locale ? new Intl.Locale(opts.locale).region : undefined;
  } catch {
    region = undefined; // malformed locale string
  }
  return {
    timeZone: opts.timeZone || DEFAULT_TIME_ZONE,
    currency: currencyForCountry(region),
  };
}
```

Create `lib/preferences/index.ts`:

```ts
export * from "./defaults";
export * from "./calendarDateInZone";
export * from "./currencyForCountry";
export * from "./localeForZone";
export * from "./formatCurrency";
export * from "./resolve";
export * from "./detect";
```

Modify `lib/design-system.ts` — delete the `formatCurrency` body (lines 1-8) and re-export instead, so existing call sites keep compiling until Task 10:

```ts
// Re-exported for now; call sites move to useFormatCurrency() from
// PreferencesContext so the user's currency applies. See lib/preferences/.
export { formatCurrency } from "./preferences/formatCurrency";
```

Modify `lib/design-system.test.ts` — remove the now-duplicated `formatCurrency` block (lines 3-7) and its import, leaving only the `getAmountColorClass` describe:

```ts
import { describe, it, expect } from "vitest";
import { getAmountColorClass } from "./design-system";

describe("getAmountColorClass", () => {
  it("returns income class for positive amounts", () => {
    expect(getAmountColorClass(10)).toBe("text-finance-income");
  });
  it("returns expense class for negative amounts", () => {
    expect(getAmountColorClass(-10)).toBe("text-finance-expense");
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/preferences lib/design-system.test.ts && npm run typecheck`
Expected: PASS, and typecheck clean (the re-export keeps all 17 call sites valid).

- [ ] **Step 5: Commit**

```bash
git add lib/preferences lib/design-system.ts lib/design-system.test.ts
git commit -m "Parameterise formatCurrency by currency+locale; add resolve/detect helpers"
```

---

### Task 4: Delete the dead relative-time helpers

`isStale` and `getRelativeTime` in `lib/design-system.ts` have **zero callers** anywhere in `app/`, `lib/`, or `server/` (verified by grep). Their day-diff arithmetic is UTC-based and would mislabel "Today" for a Sydney user before 10am — but rather than make dead code zone-aware and test it, delete it. Reinstate from git history if a caller ever appears.

**Files:**
- Modify: `lib/design-system.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (removes `isStale`, `getRelativeTime`)

- [ ] **Step 1: Confirm they are genuinely unused**

Run: `grep -rn "isStale\|getRelativeTime" app lib server components 2>/dev/null | grep -v "lib/design-system.ts"`
Expected: no output. **If this prints anything, stop** — a caller exists, so instead give both functions a `timeZone: string` parameter, implement them via `calendarDateInZone`, and add tests covering the pre-10am Sydney case.

- [ ] **Step 2: Delete the two functions**

Remove from `lib/design-system.ts`:

```ts
export function isStale(date: Date, maxDays = 3): boolean {
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  return diffDays > maxDays;
}
export function getRelativeTime(date: Date): string {
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
```

The file should retain only: the `formatCurrency` re-export, `getAmountColorClass`, `getAmountBgClass`, and `MIN_TOUCH_TARGET`.

- [ ] **Step 3: Verify nothing broke**

Run: `npm run typecheck && npm test -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/design-system.ts
git commit -m "Remove unused isStale/getRelativeTime helpers"
```

---

### Task 5: Schema, migration, and the Zod input

**Files:**
- Modify: `prisma/schema.prisma` (the `User` model, lines 9-24)
- Create: `prisma/migrations/20260809000000_user_preferences/migration.sql`
- Create: `lib/schemas/preferences.ts`
- Test: `lib/schemas/preferences.test.ts`
- Modify: `lib/schemas/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `preferencesInput` (Zod schema) · `PreferencesInput` type · `User.timeZone`, `User.currency` columns

- [ ] **Step 1: Write the failing test**

Create `lib/schemas/preferences.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { preferencesInput } from "./preferences";

describe("preferencesInput", () => {
  it("accepts a valid zone and currency", () => {
    expect(preferencesInput.safeParse({ timeZone: "Australia/Sydney", currency: "AUD" }).success)
      .toBe(true);
  });

  it("accepts just one of the two", () => {
    expect(preferencesInput.safeParse({ currency: "USD" }).success).toBe(true);
    expect(preferencesInput.safeParse({ timeZone: "Europe/London" }).success).toBe(true);
  });

  it("rejects an empty object (nothing to update)", () => {
    expect(preferencesInput.safeParse({}).success).toBe(false);
  });

  it("rejects a currency that is not a 3-letter uppercase code", () => {
    expect(preferencesInput.safeParse({ currency: "aud" }).success).toBe(false);
    expect(preferencesInput.safeParse({ currency: "AUDD" }).success).toBe(false);
    expect(preferencesInput.safeParse({ currency: "12" }).success).toBe(false);
  });

  it("rejects a timezone that is not a real IANA zone", () => {
    expect(preferencesInput.safeParse({ timeZone: "Not/AZone" }).success).toBe(false);
    expect(preferencesInput.safeParse({ timeZone: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/schemas/preferences.test.ts`
Expected: FAIL — cannot resolve `./preferences`.

- [ ] **Step 3: Write the schema and migration**

Create `lib/schemas/preferences.ts`:

```ts
import { z } from "zod";

/** Validate against the runtime's own IANA database rather than a hand-kept list. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const preferencesInput = z.object({
  timeZone: z.string().min(1).refine(isValidTimeZone, "Unknown timezone").optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO currency code").optional(),
}).refine(
  (v) => v.timeZone !== undefined || v.currency !== undefined,
  "Provide at least one preference to update",
);

export type PreferencesInput = z.infer<typeof preferencesInput>;
```

Add to `lib/schemas/index.ts`:

```ts
export * from "./preferences";
```

Add to the `User` model in `prisma/schema.prisma`, after `skipTodayDate`:

```prisma
  // Nullable on purpose: null means "never detected", which is what triggers the
  // one-time browser detection. A schema default would make a brand-new user
  // indistinguishable from one who deliberately chose Sydney/AUD.
  timeZone      String?
  currency      String?
```

Create `prisma/migrations/20260809000000_user_preferences/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT;
ALTER TABLE "User" ADD COLUMN "currency" TEXT;
```

- [ ] **Step 4: Regenerate the client and verify**

Run: `npm run db:generate && npx vitest run lib/schemas/preferences.test.ts && npm run typecheck`
Expected: PASS. (Do not run `migrate deploy` — `npm run build` applies it.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260809000000_user_preferences lib/schemas/preferences.ts lib/schemas/preferences.test.ts lib/schemas/index.ts
git commit -m "Add User.timeZone/currency columns and the preferences input schema"
```

---

### Task 6: The preferences router

**Files:**
- Create: `server/routers/preferences.ts`
- Modify: `server/routers/_app.ts`

**Interfaces:**
- Consumes: `preferencesInput` from `@/lib/schemas`, `resolvePreferences` from `@/lib/preferences`, `router`/`protectedProcedure` from `../trpc`
- Produces: `preferencesRouter`, mounted as `preferences` — `preferences.get` → `ResolvedPreferences`; `preferences.update` / `preferences.detect` → `ResolvedPreferences`

These are user-scoped, not account-scoped, so they use `protectedProcedure`. `accountProcedure` and its capability checks (`canEditItems` etc.) do not apply.

- [ ] **Step 1: Write the router**

Create `server/routers/preferences.ts`:

```ts
import { router, protectedProcedure } from "../trpc";
import { preferencesInput } from "@/lib/schemas";
import { resolvePreferences } from "@/lib/preferences";

const select = { timeZone: true, currency: true } as const;

export const preferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const row = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id }, select,
    });
    return resolvePreferences(row);
  }),

  // The user's explicit choice — unconditional.
  update: protectedProcedure.input(preferencesInput).mutation(async ({ ctx, input }) => {
    const row = await ctx.prisma.user.update({
      where: { id: ctx.user.id },
      data: { ...(input.timeZone ? { timeZone: input.timeZone } : {}),
              ...(input.currency ? { currency: input.currency } : {}) },
      select,
    });
    return resolvePreferences(row);
  }),

  // Write-once. Each column is filled ONLY while it is still null, enforced in the
  // WHERE clause so the check and the write are one atomic statement. A second tab,
  // a double-mount, or a stale client therefore can never clobber a manual choice —
  // a read-then-write would race here.
  detect: protectedProcedure.input(preferencesInput).mutation(async ({ ctx, input }) => {
    if (input.timeZone) {
      await ctx.prisma.user.updateMany({
        where: { id: ctx.user.id, timeZone: null },
        data: { timeZone: input.timeZone },
      });
    }
    if (input.currency) {
      await ctx.prisma.user.updateMany({
        where: { id: ctx.user.id, currency: null },
        data: { currency: input.currency },
      });
    }
    const row = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id }, select,
    });
    return resolvePreferences(row);
  }),
});
```

`updateMany` is required here rather than `update`: `update` matches on the unique `id` alone and would throw on a non-matching extra condition, whereas `updateMany` accepts the `timeZone: null` guard in its `where` and simply affects zero rows when the column is already set.

- [ ] **Step 2: Mount it**

Modify `server/routers/_app.ts` — add the import and the entry:

```ts
import { preferencesRouter } from "./preferences";
```

```ts
export const appRouter = router({
  account: accountRouter,
  holiday: holidayRouter,
  particular: particularRouter,
  forecast: forecastRouter,
  category: categoryRouter,
  invite: inviteRouter,
  debt: debtRouter,
  preferences: preferencesRouter,
});
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/routers/preferences.ts server/routers/_app.ts
git commit -m "Add preferences router with write-once detection"
```

---

### Task 7: `PreferencesProvider` and its hooks

**Files:**
- Create: `app/_components/PreferencesContext.tsx`
- Modify: `app/providers.tsx`

**Interfaces:**
- Consumes: `trpc.preferences.get` / `.detect`, `formatCurrency`, `calendarDateInZone`, `detectFromResolvedOptions`, `DEFAULT_*`
- Produces:
  - `PreferencesProvider` — React component
  - `usePreferences(): { timeZone: string; currency: string; locale: string; isLoading: boolean }`
  - `useFormatCurrency(): (amount: number) => string`
  - `useToday(): Date` — UTC midnight of today in the user's zone

- [ ] **Step 1: Write the provider**

Create `app/_components/PreferencesContext.tsx`, mirroring the shape of `AccountContext.tsx`:

```tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/trpc/client";
import {
  formatCurrency, calendarDateInZone, detectFromResolvedOptions,
  DEFAULT_TIME_ZONE, DEFAULT_CURRENCY, DEFAULT_LOCALE,
} from "@/lib/preferences";

type Ctx = {
  timeZone: string; currency: string; locale: string; isLoading: boolean;
};
const PreferencesCtx = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = trpc.preferences.get.useQuery(undefined, { staleTime: 30_000 });
  const utils = trpc.useUtils();
  const detect = trpc.preferences.detect.useMutation({
    onSuccess: (resolved) => { utils.preferences.get.setData(undefined, resolved); },
  });

  // One-shot browser detection for users who have never been detected. The ref
  // guards against a double-invoke under React strict mode; the server's write-once
  // rule is the real protection against races between tabs.
  const attempted = useRef(false);
  useEffect(() => {
    if (isLoading || !data || data.isDetected || attempted.current) return;
    attempted.current = true;
    const opts = Intl.DateTimeFormat().resolvedOptions();
    detect.mutate(detectFromResolvedOptions({ timeZone: opts.timeZone, locale: opts.locale }));
  }, [isLoading, data, detect]);

  const value = useMemo(() => ({
    timeZone: data?.timeZone ?? DEFAULT_TIME_ZONE,
    currency: data?.currency ?? DEFAULT_CURRENCY,
    locale: data?.locale ?? DEFAULT_LOCALE,
    isLoading,
  }), [data, isLoading]);

  return <PreferencesCtx.Provider value={value}>{children}</PreferencesCtx.Provider>;
}

export function usePreferences(): Ctx {
  const c = useContext(PreferencesCtx);
  if (!c) throw new Error("usePreferences must be used within PreferencesProvider");
  return c;
}

/** Money formatter bound to the user's currency and locale. */
export function useFormatCurrency(): (amount: number) => string {
  const { currency, locale } = usePreferences();
  return useCallback((amount: number) => formatCurrency(amount, currency, locale), [currency, locale]);
}

/**
 * UTC midnight of today in the user's zone. Memoised on the resulting timestamp so
 * the identity is stable across renders — it feeds React Query keys and effect
 * dependency arrays, which would otherwise churn on every render.
 */
export function useToday(): Date {
  const { timeZone } = usePreferences();
  const time = calendarDateInZone(new Date(), timeZone).getTime();
  return useMemo(() => new Date(time), [time]);
}
```

- [ ] **Step 2: Mount it in the provider tree**

Modify `app/providers.tsx` — add the import and wrap **outside** `AccountProvider` (preferences are user-level and account-independent):

```tsx
import { PreferencesProvider } from "@/app/_components/PreferencesContext";
```

```tsx
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <PreferencesProvider>
            <AccountProvider>{children}</AccountProvider>
          </PreferencesProvider>
        </ThemeProvider>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/_components/PreferencesContext.tsx app/providers.tsx
git commit -m "Add PreferencesProvider with useFormatCurrency/useToday and one-shot detection"
```

---

### Task 8: Locale-aware date formatters

The five `Intl.DateTimeFormat` instances in `lib/dateInput.ts` are module-level and hardcoded to `en-US`. Make them locale-keyed and memoised — constructing a formatter per call is the one real performance trap here, since the daily card list renders many.

**Files:**
- Modify: `lib/dateInput.ts:27-72` (the formatter block and the five exported functions), `lib/dateInput.ts:86-93` (`todayAsUtcDate`)
- Modify: `lib/dateInput.test.ts`

**Interfaces:**
- Consumes: `calendarDateInZone`, `DEFAULT_LOCALE`, `DEFAULT_TIME_ZONE` from `@/lib/preferences`
- Produces (all gain an optional trailing `locale`, defaulting to `DEFAULT_LOCALE`):
  - `formatUtcWeekdayMonthDay(date, locale?)` · `formatUtcMonthDayYear(date, locale?)` · `formatUtcMonthDay(date, locale?)` · `formatUtcWeekday(date, locale?)` · `formatUtcWeekdayLong(date, locale?)`
  - `todayAsUtcDate(timeZone?: string, now?: Date): Date` — **note the reordered signature**

- [ ] **Step 1: Write the failing tests**

Add to `lib/dateInput.test.ts` (keep every existing test; they now assert the `en-AU` default, so **update the existing expected strings** as noted in Step 3):

```ts
describe("locale-aware formatting", () => {
  const d = new Date(Date.UTC(2026, 6, 15)); // Wed 15 July 2026

  it("uses day-month order for en-AU (the default)", () => {
    expect(formatUtcMonthDay(d)).toBe("15 Jul");
    expect(formatUtcMonthDayYear(d)).toBe("15 Jul 2026");
  });

  it("uses month-day order for en-US", () => {
    expect(formatUtcMonthDay(d, "en-US")).toBe("Jul 15");
    expect(formatUtcMonthDayYear(d, "en-US")).toBe("Jul 15, 2026");
  });

  it("keeps weekday names locale-stable for English locales", () => {
    expect(formatUtcWeekday(d, "en-US")).toBe("Wed");
    expect(formatUtcWeekdayLong(d, "en-AU")).toBe("Wednesday");
  });

  it("still formats in UTC regardless of locale", () => {
    // 23:30 UTC on the 15th is the 16th in Sydney, but these render the UTC day.
    const late = new Date(Date.UTC(2026, 6, 15, 23, 30));
    expect(formatUtcMonthDay(late, "en-AU")).toBe("15 Jul");
  });
});

describe("todayAsUtcDate", () => {
  it("returns UTC midnight of the calendar date in the given zone", () => {
    expect(todayAsUtcDate("Australia/Sydney", new Date("2026-08-09T20:00:00Z")))
      .toEqual(new Date(Date.UTC(2026, 7, 10)));
    expect(todayAsUtcDate("America/New_York", new Date("2026-08-09T02:00:00Z")))
      .toEqual(new Date(Date.UTC(2026, 7, 8)));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/dateInput.test.ts`
Expected: FAIL — the new locale tests fail (extra argument ignored, wrong order), and `todayAsUtcDate` rejects a string first argument.

- [ ] **Step 3: Rewrite the formatter block**

Replace `lib/dateInput.ts` lines 27-72 with:

```ts
// Human-readable formatting of a UTC-anchored date, for display. The engine and DB
// store dates at UTC midnight, so formatting them with a local-time formatter (e.g.
// date-fns `format`) shows the wrong day for users west of UTC. Every formatter below
// therefore keeps timeZone: "UTC" — the LOCALE is what varies, controlling word order
// ("15 Jul" vs "Jul 15"), never which day is shown.
//
// Memoised per (locale, style): constructing an Intl.DateTimeFormat is expensive and
// the daily card list renders many of these.
type Style = "weekdayMonthDay" | "monthDayYear" | "monthDay" | "weekday" | "weekdayLong";

const OPTIONS: Record<Style, Intl.DateTimeFormatOptions> = {
  weekdayMonthDay: { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" },
  monthDayYear: { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  monthDay: { month: "short", day: "numeric", timeZone: "UTC" },
  weekday: { weekday: "short", timeZone: "UTC" },
  weekdayLong: { weekday: "long", timeZone: "UTC" },
};

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(style: Style, locale: string): Intl.DateTimeFormat {
  const key = `${locale}:${style}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, OPTIONS[style]);
    } catch {
      f = new Intl.DateTimeFormat(DEFAULT_LOCALE, OPTIONS[style]);
    }
    cache.set(key, f);
  }
  return f;
}

/** "Wed, 15 Jul" (en-AU) / "Wed, Jul 15" (en-US) — weekday, month, day in UTC. */
export function formatUtcWeekdayMonthDay(date: Date, locale: string = DEFAULT_LOCALE): string {
  return fmt("weekdayMonthDay", locale).format(date);
}

/** "15 Jul 2026" (en-AU) / "Jul 15, 2026" (en-US) — month, day, year in UTC. */
export function formatUtcMonthDayYear(date: Date, locale: string = DEFAULT_LOCALE): string {
  return fmt("monthDayYear", locale).format(date);
}

/** "15 Jul" (en-AU) / "Jul 15" (en-US) — month, day in UTC. */
export function formatUtcMonthDay(date: Date, locale: string = DEFAULT_LOCALE): string {
  return fmt("monthDay", locale).format(date);
}

/** "Wed" — short weekday in UTC. */
export function formatUtcWeekday(date: Date, locale: string = DEFAULT_LOCALE): string {
  return fmt("weekday", locale).format(date);
}

/** "Wednesday" — full weekday in UTC. */
export function formatUtcWeekdayLong(date: Date, locale: string = DEFAULT_LOCALE): string {
  return fmt("weekdayLong", locale).format(date);
}
```

Add at the top of the file:

```ts
import { calendarDateInZone, DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "@/lib/preferences";
```

Replace `todayAsUtcDate` (lines 86-93) with:

```ts
/**
 * UTC midnight of the user's current calendar day in `timeZone` — the day that shows
 * as selected in a fresh `<input type="date">`. Use for form date defaults so an
 * untouched picker submits the instant the engine expects.
 */
export function todayAsUtcDate(
  timeZone: string = DEFAULT_TIME_ZONE,
  now: Date = new Date(),
): Date {
  return calendarDateInZone(now, timeZone);
}
```

**Also update these existing assertions in `lib/dateInput.test.ts`** — they were written against `en-US` and the default is now `en-AU`. Pass `"en-US"` explicitly to each so they keep asserting what they were written to assert:
- every `formatUtcWeekdayMonthDay(...)`, `formatUtcMonthDayYear(...)`, and `formatUtcMonthDay(...)` call whose expectation contains a month-before-day string (e.g. `"Jul 15"`, `"Jun 28, 2026"`)
- leave `formatUtcWeekday` / `formatUtcWeekdayLong` / `ordinal` assertions alone — weekday names are identical across English locales
- existing `todayAsUtcDate()` calls: pass `undefined` for the zone and move the `now` argument to second position, e.g. `todayAsUtcDate(undefined, someDate)`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/dateInput.test.ts && npm run typecheck`
Expected: tests PASS. Typecheck will report errors in the four `todayAsUtcDate()` **call sites** that pass no arguments — those are fine (the defaults apply) and are wired up properly in Task 11.

- [ ] **Step 5: Commit**

```bash
git add lib/dateInput.ts lib/dateInput.test.ts
git commit -m "Make UTC date formatters locale-aware; take timezone in todayAsUtcDate"
```

---

### Task 9: Thread locale through `frequencyLabel`

`app/particulars/frequencyLabel.ts` is a pure, tested, non-React helper that calls `formatUtcWeekdayLong`/`formatUtcWeekday`, so it cannot use a hook. It takes the locale as a parameter instead.

**Files:**
- Modify: `app/particulars/frequencyLabel.ts:31-34` (signature), `:43`, `:49`
- Modify: `app/particulars/frequencyLabel.test.ts`

**Interfaces:**
- Consumes: `formatUtcWeekdayLong(date, locale)`, `formatUtcWeekday(date, locale)`, `DEFAULT_LOCALE`
- Produces: `frequencyLabel(p, today, locale?: string): string`

- [ ] **Step 1: Write the failing test**

Add to `app/particulars/frequencyLabel.test.ts`:

```ts
describe("locale", () => {
  it("defaults to en-AU weekday names", () => {
    expect(frequencyLabel({ frequency: "WEEKLY", startDate: d(2026, 7, 6) }, d(2026, 7, 1)))
      .toBe("Every Monday");
  });

  it("accepts an explicit locale", () => {
    expect(frequencyLabel({ frequency: "WEEKLY", startDate: d(2026, 7, 6) }, d(2026, 7, 1), "en-US"))
      .toBe("Every Monday");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/particulars/frequencyLabel.test.ts`
Expected: FAIL — `frequencyLabel` takes 2 arguments, not 3 (a TypeScript error under Vitest's transform).

- [ ] **Step 3: Update the implementation**

In `app/particulars/frequencyLabel.ts`, change the import and signature:

```ts
import { ordinal, formatUtcWeekdayLong, formatUtcWeekday } from "@/lib/dateInput";
import { DEFAULT_LOCALE } from "@/lib/preferences";
```

```ts
export function frequencyLabel(
  p: { frequency: Frequency; startDate: Date },
  today: Date,
  locale: string = DEFAULT_LOCALE,
): string {
```

Then pass `locale` at the two call sites — line 43 becomes:

```ts
      return `Every ${formatUtcWeekdayLong(s, locale)}`;
```

and line 49 becomes:

```ts
      const weekday = formatUtcWeekday(s, locale); // "Tue"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/particulars/frequencyLabel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/particulars/frequencyLabel.ts app/particulars/frequencyLabel.test.ts
git commit -m "Thread display locale through frequencyLabel"
```

---

### Task 10: Switch the 42 currency call sites to `useFormatCurrency()`

Mechanical and fully deterministic: **42 calls across 17 files**, all inside `"use client"` trees. No pure `.ts` helper and no server code calls `formatCurrency`, so there is no case needing the value threaded as a parameter.

**Files (call counts):**

| File | Calls |
|---|---|
| `app/_components/DashboardPage.tsx` | 7 |
| `app/_components/dashboard/DailyCard.tsx` | 6 |
| `app/debts/page.tsx` | 5 |
| `app/debts/DebtTipsPanel.tsx` | 4 |
| `app/spending/SpendingSummaryStats.tsx` | 3 |
| `app/debts/DebtForecastChart.tsx` | 3 |
| `app/spending/SpendingChart.tsx` | 2 |
| `app/accounts/page.tsx` | 2 |
| `app/_components/dashboard/BalanceSparkline.tsx` | 2 |
| `app/spending/page.tsx` | 1 |
| `app/particulars/page.tsx` | 1 |
| `app/particulars/OverrideManagement.tsx` | 1 |
| `app/debts/DebtCard.tsx` | 1 |
| `app/_components/dashboard/MetricCard.tsx` | 1 |
| `app/_components/dashboard/DangerNotification.tsx` | 1 |
| `app/_components/dashboard/AccountLowList.tsx` | 1 |
| `app/_components/dashboard/AccountBalanceList.tsx` | 1 |

- [ ] **Step 1: Apply the same three edits to every file above**

1. Replace the import
   ```ts
   import { formatCurrency } from "@/lib/design-system";
   ```
   with
   ```ts
   import { useFormatCurrency } from "@/app/_components/PreferencesContext";
   ```
   If the import also pulls in `getAmountColorClass` or `getAmountBgClass` (e.g. `app/spending/SpendingSummaryStats.tsx`), keep those on the original import line and add the new import beside it.

2. Add as the first line inside the component body:
   ```ts
   const fmt = useFormatCurrency();
   ```

3. Rename every call: `formatCurrency(` → `fmt(`.

Worked example — `app/_components/dashboard/AccountLowList.tsx`:

```diff
-import { formatCurrency } from "@/lib/design-system";
+import { useFormatCurrency } from "@/app/_components/PreferencesContext";

 export function AccountLowList({ lows }: Props) {
+  const fmt = useFormatCurrency();
   return (
     ...
-              {formatCurrency(figure)}
+              {fmt(figure)}
```

**Two files need care:**

- `app/spending/SpendingChart.tsx:34` — the call is inside a Recharts prop callback, `formatter={(v) => formatCurrency(Number(v))}`. The hook still goes in the component body; only the inner call changes:
  ```diff
  -          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
  +          <Tooltip formatter={(v) => fmt(Number(v))} />
  ```
- `app/_components/dashboard/DangerNotification.tsx` and `app/spending/SpendingSummaryStats.tsx` have no `"use client"` directive of their own but are imported by client parents, so they are client components and hooks are valid. Do **not** add a `"use client"` directive.

- [ ] **Step 2: Verify no call sites remain**

Run: `grep -rn "formatCurrency" app`
Expected: no output.

- [ ] **Step 3: Remove the compatibility re-export**

Now that nothing imports it from the old path, delete this line from `lib/design-system.ts`:

```ts
export { formatCurrency } from "./preferences/formatCurrency";
```

`lib/design-system.ts` should now contain only `getAmountColorClass`, `getAmountBgClass`, and `MIN_TOUCH_TARGET`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -- --run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app lib/design-system.ts
git commit -m "Format money through the user's currency preference"
```

---

### Task 11: Make "today" follow the timezone preference

Five sites derive "today" from the device clock. Four go through `todayAsUtcDate()`; the fifth inlines the same computation and is deleted.

**Files:**
- Modify: `app/_components/DashboardPage.tsx:32-33`
- Modify: `app/particulars/page.tsx:35`, `:126`
- Modify: `app/particulars/ParticularForm.tsx:50`
- Modify: `app/particulars/TransferForm.tsx:46`
- Modify: `app/particulars/QuickAddRow.tsx:27`

**Interfaces:**
- Consumes: `useToday()`, `usePreferences()` from `@/app/_components/PreferencesContext`; `todayAsUtcDate(timeZone, now)` from `@/lib/dateInput`
- Produces: nothing new

- [ ] **Step 1: Replace the inlined computation in `DashboardPage.tsx`**

Delete lines 32-33:

```ts
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
```

and replace with:

```ts
  const today = useToday();
```

Update the comment above it (currently lines 29-31) to read:

```ts
  // UTC midnight of the calendar date in the user's PREFERRED zone (not the device's).
  // The engine keys every day by its UTC components, so "today" must be UTC midnight
  // of the user's local date for it to land as the first daily card.
```

Add the import:

```ts
import { useToday } from "@/app/_components/PreferencesContext";
```

**Skip-today needs no change.** Line 61 (`new Date(data.skipTodayDate).getTime() === today.getTime()`) compares against `today`; now that `today` is zone-aware, the midnight reset follows automatically. This preserves the CLAUDE.md invariant that skip-today resets at the user's local midnight — "their local" now means their preference rather than their device.

- [ ] **Step 2: Pass the zone at the four `todayAsUtcDate` call sites**

`app/particulars/page.tsx` — add the imports, then line 35:

```diff
-  const today = todayAsUtcDate();
+  const { timeZone, locale } = usePreferences();
+  const today = todayAsUtcDate(timeZone);
```

and line 126, now that `frequencyLabel` takes a locale:

```diff
-              <span className="ml-2 text-xs text-muted-foreground">{frequencyLabel(p, today)}</span>
+              <span className="ml-2 text-xs text-muted-foreground">{frequencyLabel(p, today, locale)}</span>
```

`app/particulars/ParticularForm.tsx:50`, `app/particulars/TransferForm.tsx:46`, `app/particulars/QuickAddRow.tsx:27` — in each, add `const { timeZone } = usePreferences();` to the component body and pass it:

```diff
-      startDate: existing ? new Date(existing.startDate) : todayAsUtcDate(),
+      startDate: existing ? new Date(existing.startDate) : todayAsUtcDate(timeZone),
```

```diff
-  startDate: todayAsUtcDate(),
+  startDate: todayAsUtcDate(timeZone),
```

> `QuickAddRow.tsx:27` sits in a module-level object literal, not a component body. If so, move that default into the component (or into a `useMemo` keyed on `timeZone`) so it can read the preference — a module-level constant is evaluated once at import and could not react to a preference change anyway.

Leave `app/debts/page.tsx:61` alone — its `new Date()` is an optimistic-update timestamp, not a calendar date.

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test -- --run`
Expected: PASS.

- [ ] **Step 4: Confirm no device-clock "today" remains**

Run: `grep -rn "Date.UTC(now.getFullYear\|todayAsUtcDate()" app`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "Derive today from the user's timezone preference"
```

---

### Task 12: The preferences page and nav entries

**Files:**
- Create: `app/preferences/page.tsx`
- Modify: `app/_components/Sidebar.tsx:5-17`, `app/_components/BottomNav.tsx:6-17`

**Interfaces:**
- Consumes: `trpc.preferences.get` / `.update`, `usePreferences`, `CURRENCY_OPTIONS`, `formatCurrency`, `calendarDateInZone`, `localeForZone`, `formatUtcWeekdayMonthDay`
- Produces: the `/preferences` route

- [ ] **Step 1: Write the page**

Create `app/preferences/page.tsx`, following the `app/holidays/page.tsx` structure (`Layout` wrapper, shadcn `Select`/`Label`/`Button` from `@/app/_components/ui/*`, Sonner `toast.error` on failure to match the `app/debts/page.tsx` convention):

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Label } from "@/app/_components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/_components/ui/select";
import { usePreferences } from "@/app/_components/PreferencesContext";
import { CURRENCY_OPTIONS, formatCurrency, calendarDateInZone, localeForZone } from "@/lib/preferences";
import { formatUtcWeekdayMonthDay } from "@/lib/dateInput";

const ZONES: string[] = Intl.supportedValuesOf("timeZone");

export default function PreferencesPage() {
  const saved = usePreferences();
  const utils = trpc.useUtils();

  // Pending selection, so the preview reflects what you're about to save.
  const [timeZone, setTimeZone] = useState(saved.timeZone);
  const [currency, setCurrency] = useState(saved.currency);

  const update = trpc.preferences.update.useMutation({
    onSuccess: (resolved) => {
      // A singleton, not a collection — set the query data directly rather than
      // using the row helpers in lib/optimistic.ts.
      utils.preferences.get.setData(undefined, resolved);
    },
    onError: (error) => {
      setTimeZone(saved.timeZone);
      setCurrency(saved.currency);
      toast.error("Couldn't save preferences", { description: error.message });
    },
  });

  const dirty = timeZone !== saved.timeZone || currency !== saved.currency;
  const previewLocale = localeForZone(timeZone);
  const previewToday = calendarDateInZone(new Date(), timeZone);

  // Options must include the saved value even if it isn't in the curated list, so a
  // manually-set or detected exotic currency is never silently dropped on save.
  const currencyOptions = CURRENCY_OPTIONS.some((o) => o.code === saved.currency)
    ? CURRENCY_OPTIONS
    : [{ code: saved.currency, label: saved.currency }, ...CURRENCY_OPTIONS];

  return (
    <Layout>
      <div className="mx-auto max-w-xl space-y-6 p-4">
        <h1 className="text-2xl font-bold">Preferences</h1>

        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Select value={timeZone} onValueChange={setTimeZone}>
            <SelectTrigger id="timezone"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ZONES.map((z) => <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Decides what counts as “today” in your forecast, and when “skip today” resets.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="currency"><SelectValue /></SelectTrigger>
            <SelectContent>
              {currencyOptions.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Changes how amounts are displayed. It does <strong>not</strong> convert them —
            your existing figures keep their current values.
          </p>
        </div>

        <div className="rounded-md border p-3 text-sm">
          <span className="text-muted-foreground">Preview: </span>
          Balances show as {formatCurrency(1234.56, currency, previewLocale)} ·
          Today is {formatUtcWeekdayMonthDay(previewToday, previewLocale)}
        </div>

        <Button
          disabled={!dirty || update.isPending}
          onClick={() => update.mutate({ timeZone, currency })}
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Add the nav entries**

Both nav lists are maintained separately — edit **both**.

`app/_components/Sidebar.tsx` — add `Settings` to the lucide import and append to `items`:

```diff
-import { LayoutDashboard, ListOrdered, CalendarDays, PieChart, TrendingDown, Wallet, LogOut } from "lucide-react";
+import { LayoutDashboard, ListOrdered, CalendarDays, PieChart, TrendingDown, Wallet, LogOut, Settings } from "lucide-react";
```

```diff
   { to: "/accounts", label: "Accounts", icon: Wallet },
+  { to: "/preferences", label: "Preferences", icon: Settings },
 ];
```

`app/_components/BottomNav.tsx` — the same two edits (its import already includes `Sun`, `Moon`; add `Settings` alongside):

```diff
-import { LayoutDashboard, ListOrdered, CalendarDays, PieChart, Sun, Moon, TrendingDown, Wallet, LogOut } from "lucide-react";
+import { LayoutDashboard, ListOrdered, CalendarDays, PieChart, Sun, Moon, TrendingDown, Wallet, LogOut, Settings } from "lucide-react";
```

```diff
   { to: "/accounts", label: "Accounts", icon: Wallet },
+  { to: "/preferences", label: "Settings", icon: Settings },
 ];
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test -- --run`
Expected: PASS.

If `Intl.supportedValuesOf` is flagged by TypeScript, ensure `tsconfig.json`'s `lib` includes `ES2022` or later; it is available in Node 18+ and all current browsers.

- [ ] **Step 4: Commit**

```bash
git add app/preferences app/_components/Sidebar.tsx app/_components/BottomNav.tsx
git commit -m "Add the preferences page and nav entries"
```

---

## Final verification

- [ ] `npm test -- --run` — all suites pass
- [ ] `npm run typecheck` — clean
- [ ] `grep -rn "formatCurrency" app` — no output (all call sites go through the hook)
- [ ] `grep -rn "todayAsUtcDate()" app` — no output (all pass a zone)
- [ ] `grep -rn "isStale\|getRelativeTime" app lib server` — no output (deleted)
- [ ] `lib/engine/` unchanged — `git diff --stat main -- lib/engine` is empty

---

## Post-implementation note (2026-08-09)

All 12 tasks landed. The plan text above is preserved as written; these points are
stale in it, and the spec's "Amendments during implementation" section is authoritative:

- **Task 2** — `localeForZone` gained five exact-zone overrides not in the plan's table
  (`Pacific/Honolulu`, `Pacific/Guam`, `Pacific/Pago_Pago` → `en-US`;
  `America/Toronto`, `America/Vancouver` → `en-CA`). IANA namespaces are continental,
  not national, so the prefix fallback mismapped US and Canadian zones.
- **Task 8** — the expected en-AU date strings in this plan are wrong. CLDR's en-AU
  day+month skeleton uses the full month name: "15 July", not "15 Jul".
- **Task 10** — the per-file call-count table undercounts. It was generated with
  `grep -c`, which counts matching *lines*; lines with two calls counted once. The real
  figure is 45 calls across 17 files.
- **Task 4** — `isStale`/`getRelativeTime` were deleted rather than made zone-aware,
  having been found to have zero callers.
- **Missing from the plan entirely** — threading the display locale into the app's 15
  date call sites. The plan wired the locale through `lib/` and `frequencyLabel` but
  never into the components that render dates, so until the final review caught it the
  preferences preview promised a format no other screen delivered. Fixed in `0b03436`.

Final state: 17 commits + 1 fix wave, 392 tests across 52 files passing, typecheck
clean, `lib/engine/` untouched.
