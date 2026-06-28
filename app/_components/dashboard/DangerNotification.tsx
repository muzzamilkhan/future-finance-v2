import type { DailyBalance } from "@/lib/engine";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";

export function DangerNotification({ negativeBalance }: { negativeBalance: DailyBalance }) {
  return (
    <div className="rounded-md border border-finance-expense bg-finance-expense/10 p-3 text-sm">
      ⚠ Balance goes negative on {format(negativeBalance.date, "MMM d, yyyy")} ({formatCurrency(negativeBalance.closingBalance)}).
    </div>
  );
}
