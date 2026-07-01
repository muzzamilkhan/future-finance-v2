import type { DailyBalance } from "@/lib/engine";
import { Card, CardContent } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";
import { ArrowRight } from "lucide-react";
import { sortDailyEvents } from "./sortEvents";
import { AccountBadge } from "./AccountBadge";

export function DailyCard({ day, onEventClick, interactive = true, accountNames, accountIds = [] }: { day: DailyBalance; onEventClick?: (particularId: string, originalDate?: Date, currentAmount?: number, currentDate?: Date, overrideId?: string) => void; interactive?: boolean; accountNames?: Map<string, string>; accountIds?: string[] }) {
  return (
    <Card id={`day-${format(day.date, "yyyy-MM-dd")}`} className={day.isNegative ? "border-finance-expense" : undefined}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="font-medium">{format(day.date, "EEE, MMM d")}</span>
          <span className={day.closingBalance < 0 ? "text-finance-expense" : "text-foreground"}>
            {formatCurrency(day.closingBalance)}
          </span>
        </div>
        {day.events.length > 0 && (
          <ul className="mt-2 space-y-1">
            {sortDailyEvents(day.events).map((e, i) => {
              const clickable = interactive && e.isOverridable;
              return (
              <li key={`${e.particularId}-${i}`}
                  className={`flex justify-between text-sm ${clickable ? "cursor-pointer" : "cursor-default"}`}
                  onClick={() => clickable && onEventClick?.(e.particularId, e.originalDate, e.amount, day.date, e.overrideId)}>
                <span className="flex flex-wrap items-center gap-1">
                  {e.toAccountId ? (
                    <>
                      <AccountBadge accountId={e.fromAccountId} accountNames={accountNames} orderedIds={accountIds} />
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
                      <AccountBadge accountId={e.toAccountId} accountNames={accountNames} orderedIds={accountIds} />
                    </>
                  ) : (
                    <>
                      <AccountBadge accountId={e.fromAccountId} accountNames={accountNames} orderedIds={accountIds} />
                      <span>{e.name}</span>
                    </>
                  )}
                  {e.isOverridden && <span className="ml-1 text-xs text-finance-warning">(edited)</span>}
                  {e.isMovedDueToHoliday && <span className="ml-1 text-xs text-muted-foreground">(moved)</span>}
                </span>
                <span className={`shrink-0 ${e.amount < 0 ? "text-finance-expense" : "text-finance-income"}`}>
                  {formatCurrency(e.amount)}
                </span>
              </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
