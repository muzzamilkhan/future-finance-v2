import { calendarDateInZone, DEFAULT_LOCALE, DEFAULT_TIME_ZONE } from "@/lib/preferences";

// Helpers for binding a JS `Date` to a native `<input type="date">`, which
// renders and reports its value as a `yyyy-MM-dd` string (never a `Date`).
// Keeping the conversion here makes it unit-testable without a DOM.
//
// These are deliberately UTC-based. The forecast engine reads every date via
// getUTCDate()/getUTCMonth()/getUTCFullYear() (see lib/engine/dates.ts), so the
// calendar day a user picks must map to UTC midnight of that day. Using local-time
// constructors here would shift the day by one for any user east of UTC (e.g. NZ,
// UTC+12/13), where picking the 15th would otherwise store — and replay — as the 14th.

export function dateToInputValue(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function inputValueToDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

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
