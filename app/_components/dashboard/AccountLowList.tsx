"use client";

import { useFormatCurrency } from "@/app/_components/PreferencesContext";
import { formatUtcMonthDay } from "@/lib/dateInput";
import type { AccountLow } from "@/lib/engine/types";
import type { AccountListItem } from "@/app/_components/AccountContext";

/**
 * Read-only per-account lowest-balance lines inside the "Lowest Balance" card,
 * mirroring AccountBalanceList's layout. Each row shows the account's own low
 * (available credit for CREDIT, cash for DEBIT) and the date it occurs; clicking
 * scrolls to that day. Hidden for single-account users.
 */
export function AccountLowList(
  { accounts, lows, onSelect }:
  { accounts: AccountListItem[]; lows: AccountLow[]; onSelect: (date: Date) => void },
) {
  const fmt = useFormatCurrency();
  if (accounts.length <= 1) return null;
  const byId = new Map(lows.map((l) => [l.accountId, l]));
  return (
    <div className="mt-3 space-y-1 border-t pt-2">
      {accounts.map((a) => {
        const low = byId.get(a.id);
        if (!low) return null;
        const isCredit = a.type === "CREDIT";
        const figure = isCredit ? low.availableCredit ?? 0 : low.balance;
        const label = isCredit ? `${a.name} (available)` : a.name;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(low.date)}
            className="flex w-full items-center justify-between gap-2 text-sm cursor-pointer hover:opacity-80"
          >
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{label}</span>
            <span className="shrink-0 text-muted-foreground">{formatUtcMonthDay(low.date)}</span>
            <span className={figure < 0 ? "text-finance-expense" : "text-foreground"}>
              {fmt(figure)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
