"use client";

import { useMemo, useState } from "react";
import { addMonths, startOfDay } from "date-fns";
import { trpc } from "@/trpc/client";
import { computeForecast } from "@/lib/engine";
import { toEngineInputs } from "@/lib/toEngine";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { MetricCard } from "@/app/_components/dashboard/MetricCard";
import { DailyCard } from "@/app/_components/dashboard/DailyCard";
import { DangerNotification } from "@/app/_components/dashboard/DangerNotification";
import { SkipTodayButton } from "@/app/_components/dashboard/SkipTodayButton";
import { BalanceSparkline } from "@/app/_components/dashboard/BalanceSparkline";
import { UpdateBalanceModal } from "@/app/_components/dashboard/UpdateBalanceModal";
import { OverrideModal } from "@/app/_components/dashboard/OverrideModal";

export default function DashboardPage() {
  const today = startOfDay(new Date());
  const [monthsAhead, setMonthsAhead] = useState(3);
  const [skipToday, setSkipToday] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [override, setOverride] = useState<{ particularId: string; originalDate: Date; isFixed: boolean; isCritical: boolean } | null>(null);

  const viewStart = today;
  const viewEnd = addMonths(today, monthsAhead);

  const { data, isLoading } = trpc.forecast.getData.useQuery({ viewStart, viewEnd });
  const { data: particulars } = trpc.particular.list.useQuery();

  const result = useMemo(() => {
    if (!data) return null;
    const inputs = toEngineInputs(data as never);
    return computeForecast({ ...inputs, viewStart, viewEnd, today, skipToday });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, monthsAhead, skipToday]);

  if (isLoading || !result) return <Layout><p className="text-muted-foreground">Loading…</p></Layout>;

  const current = result.days[0]?.openingBalance ?? 0;
  const thisMonth = result.months[0];

  const openOverride = (particularId: string, originalDate?: Date) => {
    if (!originalDate) return;
    const p = particulars?.find((x) => x.id === particularId);
    if (!p) return;
    setOverride({ particularId, originalDate, isFixed: p.isFixed, isCritical: p.isCritical });
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setBalanceOpen(true)}>Update balance</Button>
            <SkipTodayButton skipToday={skipToday} onToggle={() => setSkipToday((s) => !s)} />
          </div>
        </div>

        {result.firstNegative && <DangerNotification negativeBalance={result.firstNegative} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Current Balance" value={current} type={current >= 0 ? "income" : "expense"} />
          <MetricCard title="Lowest Balance" value={result.lowest?.closingBalance ?? 0}
            type={(result.lowest?.closingBalance ?? 0) >= 0 ? "income" : "expense"} />
          <MetricCard title="Next Negative" value={result.firstNegative?.closingBalance ?? 0} type="warning" />
          <MetricCard title="This Month" value={thisMonth?.netChange ?? 0}
            subtitle={`${formatCurrency(thisMonth?.totalIncome ?? 0)} in, ${formatCurrency(thisMonth?.totalExpenses ?? 0)} out`}
            type={(thisMonth?.netChange ?? 0) >= 0 ? "income" : "expense"} />
        </div>

        <div className="text-foreground"><BalanceSparkline days={result.days} /></div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Daily Transactions</h2>
          {result.days
            .filter((day) => day.events.length > 0)
            .map((day) => (
              <DailyCard key={day.date.toISOString()} day={day} onEventClick={openOverride} />
            ))}
        </div>

        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setMonthsAhead((m) => m + 1)}>Load next month</Button>
        </div>
      </div>

      {balanceOpen && <UpdateBalanceModal isOpen={balanceOpen} current={current} onClose={() => setBalanceOpen(false)} />}
      {override && (
        <OverrideModal isOpen={!!override} {...override} onClose={() => setOverride(null)} />
      )}
    </Layout>
  );
}
