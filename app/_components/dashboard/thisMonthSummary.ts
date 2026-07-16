import { generateInstances } from "@/lib/engine";
import type { EngineAccount, EngineParticular, EngineHoliday } from "@/lib/engine";

export interface ThisMonthSummary {
  /** Combined balance at the very start of the current calendar month. */
  startBalance: number;
  /** Projected combined balance at the end of the current calendar month. */
  endBalance: number;
  /** Sum of income across the month (positive). */
  totalIncome: number;
  /** Sum of expenses across the month (negative). */
  totalExpenses: number;
  /** totalIncome + totalExpenses == endBalance - startBalance. */
  netChange: number;
}

/** Snap a date to UTC midnight. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Full-calendar-month cash-flow summary for the "This Month" widget.
 *
 * The forecast engine replays *forward* from today, so `months[0]` only ever
 * covers today→end-of-month. This helper instead frames the whole current month:
 * it takes each account's current balance (as of today), reverse-replays the
 * events that already happened earlier this month to recover the start-of-month
 * balance, and forward-replays the remaining events to project the end-of-month
 * balance. Total in/out and net change span the whole month.
 *
 * Works in *combined* terms (Σ debit balances + Σ available credit). Applying an
 * event's delta changes the combined line by that delta regardless of account
 * type (available credit moves 1:1 with the credit balance). Transfers move money
 * between the user's own accounts, so they net to zero on the combined line and
 * are excluded from in/out totals.
 */
export function computeThisMonthSummary(input: {
  accounts: EngineAccount[];
  particulars: EngineParticular[];
  holidays: EngineHoliday[];
  today: Date;
  skipToday: boolean;
}): ThisMonthSummary {
  const { accounts, particulars, holidays, today, skipToday } = input;

  // Combined balance as of today (before today's events) — the engine's opening
  // figure on the anchor day. Available credit tracks the credit balance 1:1, so
  // combined-delta arithmetic below is valid for both account types.
  const combinedCurrent = accounts.reduce(
    (sum, a) => sum + (a.type === "CREDIT" ? (a.creditLimit ?? 0) + a.anchorBalance : a.anchorBalance),
    0,
  );

  const t = utcDay(today);
  const todayKey = t.getTime();
  const monthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0));

  let pastNet = 0;   // net combined delta of events already applied this month (before today)
  let futureNet = 0; // net combined delta of events from today onward this month
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const p of particulars) {
    for (const inst of generateInstances(p, monthStart, monthEnd, holidays)) {
      if (inst.isSkipped) continue;
      const key = utcDay(inst.date).getTime();
      const isToday = key === todayKey;
      // Skip-today drops today's events from both the projection and the totals,
      // mirroring the rest of the dashboard.
      if (isToday && skipToday) continue;

      // Transfers net to zero on the combined line and aren't income or expense.
      const delta = p.type === "TRANSFER" ? 0 : inst.amount;

      if (key < todayKey) pastNet += delta;
      else futureNet += delta;

      if (p.type !== "TRANSFER") {
        if (inst.amount > 0) totalIncome += inst.amount;
        else totalExpenses += inst.amount;
      }
    }
  }

  const startBalance = combinedCurrent - pastNet;
  const endBalance = combinedCurrent + futureNet;

  return {
    startBalance,
    endBalance,
    totalIncome,
    totalExpenses,
    netChange: totalIncome + totalExpenses,
  };
}
