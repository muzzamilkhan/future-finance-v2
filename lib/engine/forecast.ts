import { startOfDay, compareAsc, addDays } from "date-fns";
import { generateInstances } from "./instances";
import type {
  EngineParticular, EngineHoliday, DailyBalance, DailyEvent, MonthlySummary,
} from "./types";

export interface ForecastInput {
  anchorBalance: number;
  anchorDate: Date;
  viewStart: Date;
  viewEnd: Date;
  today: Date;
  skipToday: boolean;
  particulars: EngineParticular[];
  holidays: EngineHoliday[];
}

export interface ForecastResult {
  days: DailyBalance[];
  months: MonthlySummary[];
  firstNegative: DailyBalance | null;
  lowest: DailyBalance | null;
  highest: DailyBalance | null;
}

export function computeForecast(input: ForecastInput): ForecastResult {
  const { anchorBalance, anchorDate, viewStart, viewEnd, today, skipToday, particulars, holidays } = input;

  const replayStart = startOfDay(anchorDate < viewStart ? anchorDate : viewStart);
  const displayStart = startOfDay(viewStart);
  const end = startOfDay(viewEnd);
  const todayKey = startOfDay(today).getTime();

  // Generate every instance across the replay window, grouped by day.
  const byDay = new Map<number, { name: string; particularId: string; amount: number;
    isOverridden: boolean; isSkipped: boolean; isMovedDueToHoliday: boolean;
    isOverridable: boolean; originalDate?: Date; overrideId?: string }[]>();

  for (const p of particulars) {
    const isOverridable = !p.isFixed || !p.isCritical;
    const instances = generateInstances(p, replayStart, end, holidays);
    for (const inst of instances) {
      const key = startOfDay(inst.date).getTime();
      const list = byDay.get(key) ?? [];
      list.push({
        name: p.name, particularId: p.id, amount: inst.amount,
        isOverridden: inst.isOverridden, isSkipped: inst.isSkipped,
        isMovedDueToHoliday: inst.isMovedDueToHoliday, isOverridable,
        originalDate: inst.originalDate, overrideId: inst.overrideId,
      });
      byDay.set(key, list);
    }
  }

  const days: DailyBalance[] = [];
  let running = anchorBalance;
  let cursor = replayStart;

  while (cursor <= end) {
    const key = cursor.getTime();
    const opening = running;
    const events: DailyEvent[] = [];

    for (const raw of byDay.get(key) ?? []) {
      if (raw.isSkipped) continue;
      if (skipToday && key === todayKey) continue;
      events.push({
        particularId: raw.particularId,
        name: raw.name,
        amount: raw.amount,
        kind: raw.amount >= 0 ? "income" : "expense",
        isOverridden: raw.isOverridden,
        isSkipped: raw.isSkipped,
        isMovedDueToHoliday: raw.isMovedDueToHoliday,
        isOverridable: raw.isOverridable,
        originalDate: raw.originalDate,
        overrideId: raw.overrideId,
      });
      running += raw.amount;
    }

    if (cursor >= displayStart) {
      days.push({
        date: new Date(cursor),
        openingBalance: opening,
        closingBalance: running,
        events,
        isNegative: running < 0,
      });
    }
    cursor = startOfDay(addDays(cursor, 1));
  }

  return {
    days,
    months: summarize(days),
    firstNegative: days.find((day) => day.isNegative) ?? null,
    lowest: days.length
      ? days.reduce((lo, c) => (c.closingBalance < lo.closingBalance ? c : lo))
      : null,
    highest: days.length
      ? days.reduce((hi, c) => (c.closingBalance > hi.closingBalance ? c : hi))
      : null,
  };
}

function summarize(days: DailyBalance[]): MonthlySummary[] {
  const map = new Map<string, MonthlySummary>();
  for (const day of days) {
    const k = `${day.date.getFullYear()}-${day.date.getMonth()}`;
    let s = map.get(k);
    if (!s) {
      s = {
        month: new Date(day.date.getFullYear(), day.date.getMonth(), 1),
        totalIncome: 0, totalExpenses: 0, netChange: 0,
        openingBalance: day.openingBalance, closingBalance: day.closingBalance,
        daysWithNegativeBalance: 0,
      };
      map.set(k, s);
    }
    for (const e of day.events) {
      if (e.amount > 0) s.totalIncome += e.amount;
      else s.totalExpenses += e.amount;
    }
    s.closingBalance = day.closingBalance;
    if (day.isNegative) s.daysWithNegativeBalance++;
  }
  for (const s of map.values()) s.netChange = s.totalIncome + s.totalExpenses;
  return [...map.values()].sort((a, b) => compareAsc(a.month, b.month));
}
