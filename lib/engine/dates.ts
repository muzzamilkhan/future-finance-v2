import { addDays, isWeekend, isSameDay, getYear, getMonth, getDate } from "date-fns";
import type { EngineHoliday, BdaAdjustment } from "./types";

export function isBusinessDay(date: Date, holidays: EngineHoliday[]): boolean {
  if (isWeekend(date)) return false;
  const isHoliday = holidays.some((h) =>
    h.isRecurring
      ? getMonth(h.date) === getMonth(date) && getDate(h.date) === getDate(date)
      : isSameDay(h.date, date)
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
  while (!isBusinessDay(d, holidays)) d = addDays(d, stepDir);
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
      for (let y = getYear(start); y <= getYear(end); y++) {
        const inst = new Date(y, getMonth(h.date), getDate(h.date));
        if (inst >= start && inst <= end) out.push(inst);
      }
    } else if (h.date >= start && h.date <= end) {
      out.push(h.date);
    }
  }
  return out;
}
