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
