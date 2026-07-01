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
  DailyBalance, DailyEvent, MonthlySummary, AccountExhaustion,
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
  exhaustions: AccountExhaustion[];
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

  // Per-account running balance. Each account is seeded to its anchorBalance only
  // once the cursor reaches its own anchor day; before that the account is inactive
  // and contributes nothing.
  const running = new Map<string, number>();
  // UTC-day timestamp at which each account activates.
  const anchorKeyById = new Map(accounts.map((a) => [a.id, utcDay(a.anchorDate).getTime()]));

  /** True once the cursor (a UTC-midnight ms key) has reached the account's anchor day. */
  const isActive = (accountId: string, key: number): boolean => {
    const ak = anchorKeyById.get(accountId);
    return ak !== undefined && key >= ak;
  };

  /** Apply a delta to an account's running balance, only if it is active on this day. */
  const applyLeg = (accountId: string, key: number, delta: number): void => {
    if (!isActive(accountId, key)) return;
    running.set(accountId, (running.get(accountId) ?? 0) + delta);
  };

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

  // Snapshot only the accounts active on the given day key; inactive accounts are
  // excluded entirely (they contribute nothing to the combined line).
  const snapshot = (key: number): AccountDaily[] =>
    accounts
      .filter((a) => isActive(a.id, key))
      .map((a) => {
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

    // Seed each account to its anchorBalance on the exact day it activates, BEFORE
    // taking the opening snapshot, so the activation-day opening reflects the anchor.
    for (const a of accounts) {
      if (anchorKeyById.get(a.id) === key) running.set(a.id, a.anchorBalance);
    }

    const openingSnap = snapshot(key);
    const opening = combinedOf(openingSnap);
    const events: DailyEvent[] = [];

    for (const raw of byDay.get(key) ?? []) {
      if (raw.isSkipped) continue;
      if (skipToday && key === todayKey) continue;

      // From-account leg (negative for expense & transfer; positive for income).
      // Each leg applies only if ITS account is active on this day.
      applyLeg(raw.accountId, key, raw.amount);
      // Transfer destination leg: + the same magnitude, subject to its own activation.
      if (raw.toAccountId) {
        applyLeg(raw.toAccountId, key, -raw.amount);
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

    const closingSnap = snapshot(key);
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
        hasExhaustedAccount: closingSnap.some((s) => s.isExhausted),
      });
    }
    cursor = nextUtcDay(cursor);
  }

  const firstExhaustionByAccount = new Map<string, AccountExhaustion>();
  for (const day of days) {
    for (const acct of day.accounts) {
      if (acct.isExhausted && !firstExhaustionByAccount.has(acct.accountId)) {
        firstExhaustionByAccount.set(acct.accountId, {
          accountId: acct.accountId,
          date: day.date,
          balance: acct.balance,
          availableCredit: acct.availableCredit,
          type: acct.type,
        });
      }
    }
  }
  const exhaustions = [...firstExhaustionByAccount.values()].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  return {
    days,
    months: summarize(days),
    firstNegative: days.find((d) => d.isNegative) ?? null,
    lowest: days.length ? days.reduce((lo, c) => (c.combined < lo.combined ? c : lo)) : null,
    highest: days.length ? days.reduce((hi, c) => (c.combined > hi.combined ? c : hi)) : null,
    exhaustions,
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
