import type { DailyEvent } from "@/lib/engine";

/** Income events first then expenses; each group sorted by signed amount descending. */
export function sortDailyEvents(events: DailyEvent[]): DailyEvent[] {
  const rank = (e: DailyEvent) => (e.kind === "income" ? 0 : 1);
  return [...events].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return b.amount - a.amount;
  });
}
