"use client";

import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SimulateResult } from "@/lib/engine";
import { formatCurrency } from "@/lib/design-system";
import { toDebtChartData } from "./debtChartData";

/**
 * Categorical colors for the stacked debt bands. The app defines five
 * theme-aware chart vars; a realistically small debt list wraps modulo 5.
 * Color follows the debt's stable position in `debts`, never its strategy rank.
 */
const CHART_VARS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"] as const;
const colorFor = (index: number) => `var(${CHART_VARS[index % CHART_VARS.length]})`;

/** Compact axis money: 999 → 999, 12000 → 12K, 1500000 → 1.5M. Sign preserved. */
function compactMoney(value: number): string {
  const sign = value < 0 ? "-" : "";
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${sign}${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${sign}${trim(n / 1_000)}K`;
  return `${sign}${Math.round(n)}`;
}

/** One decimal, but drop a trailing .0 (12.0 → 12, 1.5 → 1.5). */
function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export function DebtForecastChart({
  result,
  debts: debtsProp,
  baseline,
}: {
  result: SimulateResult;
  debts: { id: string; name: string }[];
  /** Comparison sim (same strategy, no extra payment); renders a dotted total line. */
  baseline?: SimulateResult;
}) {
  const debts = debtsProp ?? [];
  const data = toDebtChartData(result, debts.map((d) => d.id), baseline);
  const nameById = new Map(debts.map((d) => [d.id, d.name] as const));

  // Tick every 3rd month to avoid a crowded axis; always include the last month.
  const ticks = data
    .map((d) => d.month)
    .filter((m, i) => m % 3 === 0 || i === data.length - 1);

  return (
    <div className="grid gap-3">
      {debts.length >= 1 && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {debts.map((d, i) => (
            <span key={d.id} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: colorFor(i) }}
              />
              {d.name}
            </span>
          ))}
          {baseline && (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-4 border-t border-dashed"
                style={{ borderColor: "var(--muted-foreground)" }}
              />
              Without extra
            </span>
          )}
        </div>
      )}
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 28, right: 44, bottom: 8, left: 8 }}>
          <XAxis dataKey="month" ticks={ticks} />
          <YAxis tickFormatter={(v) => compactMoney(Number(v))} width={56} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const baselinePayload = payload.find((p) => String(p.dataKey) === "baseline");
              const rows = payload
                .filter((p) => String(p.dataKey) !== "baseline")
                .map((p) => ({
                  id: String(p.dataKey),
                  name: nameById.get(String(p.dataKey)) ?? String(p.dataKey),
                  color: p.color as string,
                  value: Number(p.value) || 0,
                }))
                .filter((r) => r.value > 0);
              const total = rows.reduce((s, r) => s + r.value, 0);
              const baselineValue = baselinePayload ? Number(baselinePayload.value) || 0 : null;
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                  <p className="mb-1 font-medium">Month {String(label)}</p>
                  <div className="grid gap-0.5">
                    {rows.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: r.color }}
                          />
                          {r.name}
                        </span>
                        <span className="tabular-nums">{formatCurrency(r.value)}</span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between gap-4 border-t pt-1 font-medium">
                      <span>Total</span>
                      <span className="tabular-nums">{formatCurrency(total)}</span>
                    </div>
                    {baselineValue !== null && (
                      <div className="flex items-center justify-between gap-4 text-muted-foreground">
                        <span>Without extra</span>
                        <span className="tabular-nums">{formatCurrency(baselineValue)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
          {debts.map((d, i) => (
            <Area
              key={d.id}
              type="monotone"
              stackId="debts"
              dataKey={d.id}
              name={d.name}
              stroke={colorFor(i)}
              strokeWidth={1.5}
              fill={colorFor(i)}
              fillOpacity={0.85}
              isAnimationActive={false}
              dot={false}
            />
          ))}
          {baseline && (
            <Line
              type="monotone"
              dataKey="baseline"
              name="Without extra"
              stroke="var(--muted-foreground)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              isAnimationActive={false}
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
