import type { DailyEvent } from "@/lib/engine";

/**
 * Display label for a daily event. Transfers (toAccountId set) render as
 * "<from> -> <to>" using the account-name map; everything else uses the name.
 */
export function eventLabel(e: Pick<DailyEvent, "name" | "fromAccountId" | "toAccountId">, accountNames?: Map<string, string>): string {
  if (!e.toAccountId) return e.name;
  const from = accountNames?.get(e.fromAccountId) ?? "?";
  const to = accountNames?.get(e.toAccountId) ?? "?";
  return `${from} -> ${to}`;
}
