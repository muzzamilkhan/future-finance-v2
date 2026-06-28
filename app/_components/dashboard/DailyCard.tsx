import type { DailyBalance } from "@/lib/engine";
import { Card, CardContent } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";

export function DailyCard({ day, onEventClick }: { day: DailyBalance; onEventClick?: (particularId: string, originalDate?: Date) => void }) {
  return (
    <Card className={day.isNegative ? "border-finance-expense" : undefined}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="font-medium">{format(day.date, "EEE, MMM d")}</span>
          <span className={day.closingBalance < 0 ? "text-finance-expense" : "text-foreground"}>
            {formatCurrency(day.closingBalance)}
          </span>
        </div>
        {day.events.length > 0 && (
          <ul className="mt-2 space-y-1">
            {day.events.map((e, i) => (
              <li key={`${e.particularId}-${i}`}
                  className="flex cursor-pointer justify-between text-sm"
                  onClick={() => onEventClick?.(e.particularId, e.originalDate)}>
                <span>
                  {e.name}
                  {e.isOverridden && <span className="ml-1 text-xs text-finance-warning">(edited)</span>}
                  {e.isMovedDueToHoliday && <span className="ml-1 text-xs text-muted-foreground">(moved)</span>}
                </span>
                <span className={e.amount < 0 ? "text-finance-expense" : "text-finance-income"}>
                  {formatCurrency(e.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
