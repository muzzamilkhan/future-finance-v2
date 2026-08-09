import type { DailyBalance } from "@/lib/engine";
import { useFormatCurrency } from "@/app/_components/PreferencesContext";
import { formatUtcMonthDayYear } from "@/lib/dateInput";

export function DangerNotification({ negativeBalance }: { negativeBalance: DailyBalance }) {
  const fmt = useFormatCurrency();
  return (
    <div className="rounded-md border border-finance-expense bg-finance-expense/10 p-3 text-sm">
      ⚠ Balance goes negative on {formatUtcMonthDayYear(negativeBalance.date)} ({fmt(negativeBalance.closingBalance)}).
    </div>
  );
}
