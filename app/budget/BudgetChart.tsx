"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { BudgetSummary } from "@/lib/budget/budget";
import { toPieData, type PieDatum } from "./budgetChartData";
import { formatCurrency } from "@/lib/design-system";

const CATEGORY_COLORS = [
  "#2563eb", "#16a34a", "#db2777", "#d97706", "#7c3aed",
  "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#059669",
];
const UNTAGGED_COLOR = "#94a3b8";
const SURPLUS_COLOR = "#22c55e";

function colorFor(d: PieDatum, i: number): string {
  if (d.kind === "surplus") return SURPLUS_COLOR;
  if (d.kind === "untagged") return UNTAGGED_COLOR;
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length]!;
}

export function BudgetChart({ summary }: { summary: BudgetSummary }) {
  const data = toPieData(summary);
  const isDeficit = summary.surplus < 0;

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={2}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={colorFor(d, i)} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => formatCurrency(Number(v))} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-muted-foreground">Monthly expenses</span>
        <span className={`text-2xl font-bold ${isDeficit ? "text-finance-expense" : ""}`}>
          {formatCurrency(summary.totalExpense)}
        </span>
      </div>
      {isDeficit && (
        <div className="mt-3 rounded-md border border-finance-expense/40 bg-finance-expense/10 p-3 text-center">
          <span className="font-semibold text-finance-expense">
            Deficit: {formatCurrency(summary.surplus)}
          </span>
          <p className="text-xs text-muted-foreground">
            Monthly expenses exceed income by {formatCurrency(Math.abs(summary.surplus))}.
          </p>
        </div>
      )}
    </div>
  );
}
