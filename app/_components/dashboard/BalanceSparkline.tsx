"use client";

import { useEffect, useState } from "react";
import type { DailyBalance } from "@/lib/engine";
import { useFormatCurrency } from "@/app/_components/PreferencesContext";
import { formatUtcWeekdayMonthDay } from "@/lib/dateInput";
import { isSameDay } from "date-fns";
import {
  LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, ReferenceDot,
} from "recharts";

type Point = { i: number; date: Date; v: number };

export function BalanceSparkline({
  days, lowest, highest,
}: {
  days: DailyBalance[];
  lowest: DailyBalance | null;
  highest: DailyBalance | null;
}) {
  const fmt = useFormatCurrency();
  const data: Point[] = days.map((d, i) => ({ i, date: d.date, v: d.closingBalance }));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const active = activeIndex != null ? (data[activeIndex] ?? null) : null;

  const label = active
    ? `${formatUtcWeekdayMonthDay(active.date)} · ${fmt(active.v)}`
    : lowest && highest
      ? `Low ${fmt(lowest.closingBalance)} · High ${fmt(highest.closingBalance)}`
      : "";

  const indexOf = (d: DailyBalance | null) =>
    d ? data.findIndex((p) => isSameDay(p.date, d.date)) : -1;
  const lowIdx = indexOf(lowest);
  const highIdx = indexOf(highest);

  return (
    <div>
      <div className="mb-1 h-5 text-xs text-muted-foreground tabular-nums">{label}</div>
      <ResponsiveContainer width="100%" height={64}>
        <LineChart
          data={data}
          onMouseLeave={() => setActiveIndex(null)}
          onTouchEnd={() => setActiveIndex(null)}
        >
          <XAxis dataKey="i" type="number" domain={[0, data.length - 1]} hide />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          {/*
            Drive the label off recharts' own resolved active index — works for
            both mouse and touch. A custom (invisible) tooltip content lets us
            read the active payload recharts computes for either input type,
            avoiding the timing gap in the external onMouseMove/onTouchMove path.
          */}
          <Tooltip
            content={({ active: isActive, payload }) => (
              <ActiveReporter
                index={isActive && payload?.length ? (payload[0]!.payload as Point).i : null}
                onChange={setActiveIndex}
              />
            )}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.3 }}
          />
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

/** Renders nothing; reports recharts' active index to the parent as a side effect. */
function ActiveReporter({ index, onChange }: { index: number | null; onChange: (i: number | null) => void }) {
  useEffect(() => {
    onChange(index);
  }, [index, onChange]);
  return null;
}
