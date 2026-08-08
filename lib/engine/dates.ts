import type { EngineHoliday, BdaAdjustment } from "./types";

/** UTC same-day compare (timezone-safe). */
function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** Snap a date to UTC midnight. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * UTC-only date arithmetic. date-fns' add* helpers work in local time, which
 * shifts a UTC-midnight date by an hour across a DST boundary and rolls it onto
 * the previous UTC day — everything else in the engine compares in UTC, so a
 * fortnightly item would silently change weekday. Step in UTC instead.
 */
export function addUtcDays(d: Date, days: number): Date {
  return new Date(utcDay(d).getTime() + days * 86_400_000);
}

/** Adds months in UTC, clamping to the last day of a shorter target month. */
export function addUtcMonths(d: Date, months: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function addUtcYears(d: Date, years: number): Date {
  return addUtcMonths(d, years * 12);
}

export function isBusinessDay(date: Date, holidays: EngineHoliday[]): boolean {
  const dow = date.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow === 0 || dow === 6) return false;
  const isHoliday = holidays.some((h) =>
    h.isRecurring
      ? h.date.getUTCMonth() === date.getUTCMonth() && h.date.getUTCDate() === date.getUTCDate()
      : sameUtcDay(h.date, date)
  );
  return !isHoliday;
}

export function adjustToBusinessDay(
  date: Date,
  adjustment: BdaAdjustment,
  holidays: EngineHoliday[]
): Date {
  if (adjustment === "NONE") return date;
  const stepDir = adjustment === "NEXT_BUSINESS_DAY" ? 1 : -1;
  let d = date;
  while (!isBusinessDay(d, holidays)) {
    d = new Date(utcDay(d).getTime() + stepDir * 86_400_000);
  }
  return d;
}

export function expandRecurringHolidays(
  holidays: EngineHoliday[],
  start: Date,
  end: Date
): Date[] {
  const out: Date[] = [];
  for (const h of holidays) {
    if (h.isRecurring) {
      for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
        const inst = new Date(Date.UTC(y, h.date.getUTCMonth(), h.date.getUTCDate()));
        if (inst >= start && inst <= end) out.push(inst);
      }
    } else if (h.date >= start && h.date <= end) {
      out.push(h.date);
    }
  }
  return out;
}
