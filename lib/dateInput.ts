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
// date-fns `format`) shows the wrong day for users west of UTC. Formatting the UTC
// wall-clock keeps the displayed day consistent with the stored/engine day everywhere.
// en-US ordering ("Jul 15") to match the format strings these replaced; the UTC
// timeZone is the point of this helper. (Currency uses en-NZ; that's separate.)
const utcWeekdayMonthDay = new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
});
const utcMonthDayYear = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const utcMonthDay = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
});
const utcWeekday = new Intl.DateTimeFormat("en-US", {
  weekday: "short", timeZone: "UTC",
});

/** "Tue, Jul 15" — weekday, month, day in UTC. */
export function formatUtcWeekdayMonthDay(date: Date): string {
  return utcWeekdayMonthDay.format(date);
}

/** "Jul 15, 2026" — month, day, year in UTC. */
export function formatUtcMonthDayYear(date: Date): string {
  return utcMonthDayYear.format(date);
}

/** "Jul 15" — month, day in UTC. */
export function formatUtcMonthDay(date: Date): string {
  return utcMonthDay.format(date);
}

/** "Wed" — short weekday in UTC. */
export function formatUtcWeekday(date: Date): string {
  return utcWeekday.format(date);
}

// UTC midnight of the user's *local* calendar day — i.e. the day that shows as
// selected in a fresh `<input type="date">`. Use this for form date defaults so
// an untouched picker submits the same instant the engine expects, rather than a
// raw `new Date()` (which carries a local time-of-day that can land on the wrong
// UTC day near midnight). Read the local calendar day, then re-anchor it at UTC.
export function todayAsUtcDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
