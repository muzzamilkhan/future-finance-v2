import type { DailyBalance } from "@/lib/engine";
import { Card, CardContent } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";
import { sortDailyEvents } from "./sortEvents";
import { eventLabel } from "./eventLabel";

export function DailyCard({ day, onEventClick, interactive = true, accountNames }: { day: DailyBalance; onEventClick?: (particularId: string, originalDate?: Date, currentAmount?: number, currentDate?: Date, overrideId?: string) => void; interactive?: boolean; accountNames?: Map<string, string> }) {
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
                <span>
                  {eventLabel(e, accountNames)}
                  {e.isOverridden && <span className="ml-1 text-xs text-finance-warning">(edited)</span>}
                  {e.isMovedDueToHoliday && <span className="ml-1 text-xs text-muted-foreground">(moved)</span>}
                </span>
                <span className={e.amount < 0 ? "text-finance-expense" : "text-finance-income"}>
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
