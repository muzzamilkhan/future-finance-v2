import type { BudgetSummary } from "@/lib/budget/budget";
import { formatCurrency, getAmountColorClass } from "@/lib/design-system";

export function BudgetSummaryStats({ summary }: { summary: BudgetSummary }) {
  const isDeficit = summary.surplus < 0;

  return (
    <div className="flex flex-col justify-center gap-4">
      <Stat
        label="Total income"
        value={formatCurrency(summary.monthlyIncome)}
        className="text-finance-income"
      />
      <Stat
        label="Total expense"
        value={formatCurrency(summary.totalExpense)}
        className="text-finance-expense"
      />
      <Stat
        label={isDeficit ? "Deficit" : "Surplus"}
        value={formatCurrency(Math.abs(summary.surplus))}
        className={getAmountColorClass(summary.surplus)}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold ${className}`}>
        {value}
        <span className="text-sm font-normal text-muted-foreground">/mo</span>
      </div>
    </div>
  );
}
