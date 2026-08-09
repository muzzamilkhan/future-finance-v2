"use client";

import type { SpendingSummary } from "@/lib/spending/spending";
import { getAmountColorClass } from "@/lib/design-system";
import { useFormatCurrency } from "@/app/_components/PreferencesContext";

export function SpendingSummaryStats({ summary }: { summary: SpendingSummary }) {
  const fmt = useFormatCurrency();
  const isDeficit = summary.surplus < 0;

  return (
    <div className="flex flex-col justify-center gap-4 text-right">
      <Stat
        label="Total income"
        value={fmt(summary.monthlyIncome)}
        className="text-finance-income"
      />
      <Stat
        label="Total expense"
        value={fmt(summary.totalExpense)}
        className="text-finance-expense"
      />
      <Stat
        label={isDeficit ? "Deficit" : "Surplus"}
        value={fmt(Math.abs(summary.surplus))}
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
