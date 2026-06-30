import { compareAsc } from "date-fns";
import { generateInstances } from "./instances";

/** Snap a date to UTC midnight (timezone-safe equivalent of startOfDay for UTC-keyed dates). */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Advance a UTC-midnight date by one calendar day. */
function nextUtcDay(d: Date): Date {
  return new Date(d.getTime() + 86_400_000);
}
import type {
  EngineParticular, EngineHoliday, EngineAccount, AccountDaily,
  DailyBalance, DailyEvent, MonthlySummary,
} from "./types";

export interface ForecastInput {
  accounts: EngineAccount[];
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

type RawEvent = {
  name: string; particularId: string; amount: number; accountId: string; toAccountId: string | null;
  isOverridden: boolean; isSkipped: boolean; isMovedDueToHoliday: boolean;
  isOverridable: boolean; originalDate?: Date; overrideId?: string;
};

export function computeForecast(input: ForecastInput): ForecastResult {
  const { accounts, viewStart, viewEnd, today, skipToday, particulars, holidays } = input;

  const earliestAnchor = accounts.reduce(
    (min, a) => (a.anchorDate < min ? a.anchorDate : min),
    viewStart,
  );
  const replayStart = utcDay(earliestAnchor < viewStart ? earliestAnchor : viewStart);
  const displayStart = utcDay(viewStart);
  const end = utcDay(viewEnd);
  const todayKey = utcDay(today).getTime();

  // Per-account running balance, seeded at anchor.
  const running = new Map<string, number>();
  for (const a of accounts) running.set(a.id, a.anchorBalance);
  const acctById = new Map(accounts.map((a) => [a.id, a]));

  // Group raw events by day.
  const byDay = new Map<number, RawEvent[]>();
  for (const p of particulars) {
    const isOverridable = !p.isFixed || !p.isCritical;
    for (const inst of generateInstances(p, replayStart, end, holidays)) {
      const key = utcDay(inst.date).getTime();
      const list = byDay.get(key) ?? [];
      list.push({
        name: p.name, particularId: p.id, amount: inst.amount,
        accountId: p.accountId, toAccountId: p.toAccountId,
        isOverridden: inst.isOverridden, isSkipped: inst.isSkipped,
        isMovedDueToHoliday: inst.isMovedDueToHoliday, isOverridable,
        originalDate: inst.originalDate, overrideId: inst.overrideId,
      });
      byDay.set(key, list);
    }
  }

  const snapshot = (): AccountDaily[] =>
    accounts.map((a) => {
      const bal = running.get(a.id)!;
      const availableCredit = a.type === "CREDIT" ? (a.creditLimit ?? 0) + bal : null;
      const isExhausted = a.type === "CREDIT" ? (availableCredit as number) < 0 : bal < 0;
      return { accountId: a.id, type: a.type, balance: bal, availableCredit, isExhausted };
    });

  const combinedOf = (snap: AccountDaily[]): number =>
    snap.reduce((sum, s) => sum + (s.type === "CREDIT" ? (s.availableCredit ?? 0) : s.balance), 0);

  const days: DailyBalance[] = [];
  let cursor = replayStart;

  while (cursor <= end) {
    const key = cursor.getTime();
    const openingSnap = snapshot();
    const opening = combinedOf(openingSnap);
    const events: DailyEvent[] = [];

    for (const raw of byDay.get(key) ?? []) {
      if (raw.isSkipped) continue;
      if (skipToday && key === todayKey) continue;

      // From-account leg (negative for expense & transfer; positive for income).
      running.set(raw.accountId, (running.get(raw.accountId) ?? 0) + raw.amount);
      // Transfer destination leg: + the same magnitude.
      if (raw.toAccountId) {
        running.set(raw.toAccountId, (running.get(raw.toAccountId) ?? 0) - raw.amount);
      }

      const kind: DailyEvent["kind"] = raw.toAccountId ? "expense" : raw.amount >= 0 ? "income" : "expense";
      events.push({
        particularId: raw.particularId,
        name: raw.name,
        amount: raw.amount,
        kind,
        fromAccountId: raw.accountId,
        toAccountId: raw.toAccountId,
        isOverridden: raw.isOverridden,
        isSkipped: raw.isSkipped,
        isMovedDueToHoliday: raw.isMovedDueToHoliday,
        isOverridable: raw.isOverridable,
        originalDate: raw.originalDate,
        overrideId: raw.overrideId,
      });
    }

    const closingSnap = snapshot();
    const combined = combinedOf(closingSnap);

    if (cursor >= displayStart) {
      days.push({
        date: new Date(cursor),
        openingBalance: opening,
        closingBalance: combined,
        combined,
        accounts: closingSnap,
        events,
        isNegative: combined < 0,
      });
    }
    cursor = nextUtcDay(cursor);
  }

  return {
    days,
    months: summarize(days),
    firstNegative: days.find((d) => d.isNegative) ?? null,
    lowest: days.length ? days.reduce((lo, c) => (c.combined < lo.combined ? c : lo)) : null,
    highest: days.length ? days.reduce((hi, c) => (c.combined > hi.combined ? c : hi)) : null,
  };
}

function summarize(days: DailyBalance[]): MonthlySummary[] {
  const map = new Map<string, MonthlySummary>();
  for (const day of days) {
    const k = `${day.date.getUTCFullYear()}-${day.date.getUTCMonth()}`;
    let s = map.get(k);
    if (!s) {
      s = {
        month: new Date(Date.UTC(day.date.getUTCFullYear(), day.date.getUTCMonth(), 1)),
        totalIncome: 0, totalExpenses: 0, netChange: 0,
        openingBalance: day.openingBalance, closingBalance: day.closingBalance,
        combinedClosing: day.combined,
        daysWithNegativeBalance: 0,
      };
      map.set(k, s);
    }
    for (const e of day.events) {
      if (e.amount > 0) s.totalIncome += e.amount;
      else s.totalExpenses += e.amount;
    }
    s.closingBalance = day.closingBalance;
    s.combinedClosing = day.combined;
    if (day.isNegative) s.daysWithNegativeBalance++;
  }
  for (const s of map.values()) s.netChange = s.totalIncome + s.totalExpenses;
  return [...map.values()].sort((a, b) => compareAsc(a.month, b.month));
}
