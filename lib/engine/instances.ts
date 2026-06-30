import { addWeeks, addMonths, addYears, isSameDay } from "date-fns";
import { adjustToBusinessDay } from "./dates";
import type { EngineParticular, EngineHoliday, EngineOverride, Instance } from "./types";

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function findOverride(overrides: EngineOverride[], date: Date): EngineOverride | undefined {
  return overrides.find((o) => sameUtcDay(o.originalDate, date));
}

function signed(type: EngineParticular["type"], amount: number): number {
  return type === "INCOME" ? Math.abs(amount) : -Math.abs(amount);
}

function step(date: Date, freq: EngineParticular["frequency"]): Date {
  switch (freq) {
    case "WEEKLY": return addWeeks(date, 1);
    case "FORTNIGHTLY": return addWeeks(date, 2);
    case "MONTHLY": return addMonths(date, 1);
    case "ANNUAL": return addYears(date, 1);
    default: return date;
  }
}

export function generateInstances(
  p: EngineParticular,
  viewStart: Date,
  viewEnd: Date,
  holidays: EngineHoliday[]
): Instance[] {
  const out: Instance[] = [];

  const emit = (occurrence: Date) => {
    const override = findOverride(p.overrides, occurrence);

    if (override?.isSkipped) {
      out.push({
        date: occurrence, amount: 0, isOverridden: true, isSkipped: true,
        isMovedDueToHoliday: false, originalDate: occurrence, overrideId: override.id,
      });
      return;
    }

    const effectiveDate = override?.overriddenDate
      ?? adjustToBusinessDay(occurrence, p.businessDayAdjustment, holidays);
    const rawAmount = override?.overriddenAmount ?? p.amount;
    const isMoved = !override?.overriddenDate && !isSameDay(occurrence, effectiveDate);

    out.push({
      date: effectiveDate,
      amount: signed(p.type, rawAmount),
      isOverridden: !!override,
      isSkipped: false,
      isMovedDueToHoliday: isMoved,
      originalDate: occurrence,
      overrideId: override?.id,
    });
  };

  if (p.frequency === "ONCE_OFF") {
    if (p.startDate >= viewStart && p.startDate <= viewEnd) emit(p.startDate);
    return out;
  }

  let current = p.startDate;
  const hardEnd = p.endDate ?? viewEnd;
  while (current <= hardEnd && current <= viewEnd) {
    if (current >= viewStart) emit(current);
    current = step(current, p.frequency);
  }
  return out;
}
