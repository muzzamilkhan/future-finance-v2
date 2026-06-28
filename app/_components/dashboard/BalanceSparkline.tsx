"use client";

import type { DailyBalance } from "@/lib/engine";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

export function BalanceSparkline({ days }: { days: DailyBalance[] }) {
  const data = days.map((d) => ({ v: d.closingBalance }));
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line type="monotone" dataKey="v" dot={false} strokeWidth={2} stroke="currentColor" />
      </LineChart>
    </ResponsiveContainer>
  );
}
