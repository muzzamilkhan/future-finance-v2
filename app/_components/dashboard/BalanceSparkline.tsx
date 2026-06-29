"use client";

import { useState } from "react";
import type { DailyBalance } from "@/lib/engine";
import { formatCurrency } from "@/lib/design-system";
import { format, isSameDay } from "date-fns";
import {
  LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, ReferenceDot,
} from "recharts";
import type { MouseHandlerDataParam } from "recharts";

type Point = { i: number; date: Date; v: number };

export function BalanceSparkline({
  days, lowest, highest,
}: {
  days: DailyBalance[];
  lowest: DailyBalance | null;
  highest: DailyBalance | null;
}) {
  const data: Point[] = days.map((d, i) => ({ i, date: d.date, v: d.closingBalance }));
  const [active, setActive] = useState<Point | null>(null);

  const label = active
    ? `${format(active.date, "EEE, MMM d")} · ${formatCurrency(active.v)}`
    : lowest && highest
      ? `Low ${formatCurrency(lowest.closingBalance)} · High ${formatCurrency(highest.closingBalance)}`
      : "";

  const indexOf = (d: DailyBalance | null) =>
    d ? data.findIndex((p) => isSameDay(p.date, d.date)) : -1;
  const lowIdx = indexOf(lowest);
  const highIdx = indexOf(highest);

  // Shared by mouse + touch: recharts populates activeTooltipIndex on both.
  const onScrub = (s: MouseHandlerDataParam) => {
    const idx = typeof s?.activeTooltipIndex === "number" ? s.activeTooltipIndex : -1;
    setActive(idx >= 0 ? (data[idx] ?? null) : null);
  };

  return (
    <div>
      <div className="mb-1 h-5 text-xs text-muted-foreground tabular-nums">{label}</div>
      <ResponsiveContainer width="100%" height={64}>
        <LineChart
          data={data}
          onMouseMove={onScrub}
          onMouseLeave={() => setActive(null)}
          onTouchStart={onScrub}
          onTouchMove={onScrub}
          onTouchEnd={() => setActive(null)}
        >
          <XAxis dataKey="i" type="number" domain={[0, data.length - 1]} hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip content={() => null} cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }} />
          <Line type="monotone" dataKey="v" dot={false} strokeWidth={2} stroke="currentColor" isAnimationActive={false} />
          {lowIdx >= 0 && (
            <ReferenceDot x={lowIdx} y={data[lowIdx]!.v} r={3}
              className="fill-finance-expense" stroke="none" />
          )}
          {highIdx >= 0 && (
            <ReferenceDot x={highIdx} y={data[highIdx]!.v} r={3}
              className="fill-finance-income" stroke="none" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
