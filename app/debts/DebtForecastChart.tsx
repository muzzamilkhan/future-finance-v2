"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SimulateResult } from "@/lib/engine";
import { formatCurrency } from "@/lib/design-system";

export function DebtForecastChart({ result }: { result: SimulateResult }) {
  const data = result.months.map((m) => ({ month: m.month, balance: Math.round(m.totalBalance * 100) / 100 }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <XAxis dataKey="month" tickFormatter={(m) => `${m}mo`} />
        <YAxis tickFormatter={(v) => formatCurrency(Number(v))} width={80} />
        <Tooltip
          formatter={(v) => formatCurrency(Number(v))}
          labelFormatter={(m) => `Month ${m}`}
        />
        <Line type="monotone" dataKey="balance" stroke="#2563eb" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
