"use client";

import { useMemo, useState } from "react";
import { addMonths, format, isSameDay } from "date-fns";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/trpc/client";
import { computeForecast } from "@/lib/engine";
import { toCombinedEngineInputs } from "@/lib/toEngine";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { MetricCard } from "@/app/_components/dashboard/MetricCard";
import { AccountBalanceList } from "@/app/_components/dashboard/AccountBalanceList";
import { DailyCard } from "@/app/_components/dashboard/DailyCard";
import { DangerNotification } from "@/app/_components/dashboard/DangerNotification";
import { SkipTodayButton } from "@/app/_components/dashboard/SkipTodayButton";
import { BalanceSparkline } from "@/app/_components/dashboard/BalanceSparkline";
import { OverrideModal } from "@/app/_components/dashboard/OverrideModal";
import { CollapsibleTopSection } from "@/app/_components/dashboard/CollapsibleTopSection";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { updateRow } from "@/lib/optimistic";

export default function DashboardPage() {
  // UTC midnight of the *local* calendar date. The engine keys every day by its
  // UTC components (utcDay), so passing local startOfDay in a positive-UTC-offset
  // timezone would land the window one calendar day early. Anchoring to UTC
  // midnight of the local date keeps "today" as the first daily card.
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const [monthsAhead, setMonthsAhead] = useState(6);
  const [skipToday, setSkipToday] = useState(false);
  const [override, setOverride] = useState<{ particularId: string; originalDate: Date; isFixed: boolean; isCritical: boolean; currentAmount: number; currentDate: Date; overrideId?: string } | null>(null);

  // Skip-today shifts the visible window to tomorrow (and the engine also drops
  // today's events from the running balance via skipToday). The list then starts
  // at tomorrow instead of today.
  const viewStart = skipToday ? new Date(today.getTime() + 86_400_000) : today;
  const viewEnd = addMonths(today, monthsAhead);

  const { accountId, accounts, activeMembership } = useActiveAccount();
  const canUpdateBalance = !activeMembership || activeMembership.role === "OWNER" || activeMembership.canUpdateBalance;
  const canEditOverrides = !activeMembership || activeMembership.role === "OWNER" || activeMembership.canEditOverrides;
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.forecast.getCombined.useQuery(
    { viewStart, viewEnd },
    { placeholderData: keepPreviousData },
  );
  const { data: particulars } = trpc.particular.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId },
  );
  const updateBalance = trpc.account.updateBalance.useMutation({
    onMutate: async (vars) => {
      await utils.account.list.cancel();
      const prev = utils.account.list.getData();
      utils.account.list.setData(undefined, (old) =>
        updateRow(old, vars.accountId, { currentBalance: vars.balance } as never),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.account.list.setData(undefined, ctx.prev); },
    onSettled: () => { utils.account.list.invalidate(); utils.forecast.getCombined.invalidate(); },
  });

  const scrollToDay = (date: Date) => {
    document
      .getElementById(`day-${format(date, "yyyy-MM-dd")}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const result = useMemo(() => {
    if (!data) return null;
    const inputs = toCombinedEngineInputs(data as never);
    return computeForecast({ ...inputs, viewStart, viewEnd, today, skipToday });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, monthsAhead, skipToday]);

  const accountNames = useMemo(
    () => new Map((data?.accounts ?? []).map((a) => [a.id, a.name] as const)),
    [data],
  );
  const accountIds = useMemo(
    () => (data?.accounts ?? []).map((a) => a.id),
    [data],
  );

  if (isLoading || !result) return <Layout><p className="text-muted-foreground">Loading…</p></Layout>;

  const current = result.days[0]?.openingBalance ?? 0;
  const thisMonth = result.months[0];

  const openOverride = (particularId: string, originalDate?: Date, currentAmount?: number, currentDate?: Date, overrideId?: string) => {
    if (!canEditOverrides) return;
    if (!originalDate || currentAmount === undefined || !currentDate) return;
    const p = particulars?.find((x) => x.id === particularId);
    if (!p) return;
    // Fixed + critical occurrences have nothing the user can override
    // (amount needs !isFixed; date/skip needs !isCritical). Don't open the modal.
    if (p.isFixed && p.isCritical) return;
    setOverride({ particularId, originalDate, isFixed: p.isFixed, isCritical: p.isCritical, currentAmount, currentDate, overrideId });
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex gap-2">
            <SkipTodayButton skipToday={skipToday} onToggle={() => setSkipToday((s) => !s)} />
          </div>
        </div>

        {result.firstNegative && <DangerNotification negativeBalance={result.firstNegative} />}

        <CollapsibleTopSection
          compact={
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{formatCurrency(current)}</span>
              {result.lowest && (
                <span className="text-muted-foreground">
                  Low {formatCurrency(result.lowest.closingBalance)} · {format(result.lowest.date, "MMM d")}
                </span>
              )}
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            <MetricCard title="Current Balance" value={current} type={current >= 0 ? "income" : "expense"}
              editable={canUpdateBalance && accounts.length <= 1}
              onSave={(balance) => updateBalance.mutate({ accountId: accountId!, balance })}
              footer={
                <AccountBalanceList
                  accounts={accounts}
                  onSave={(id, balance) => updateBalance.mutate({ accountId: id, balance })}
                />
              } />
            <MetricCard title="Lowest Balance" value={result.lowest?.closingBalance ?? 0}
              type={(result.lowest?.closingBalance ?? 0) >= 0 ? "income" : "expense"}
              subtitle={result.lowest ? format(result.lowest.date, "EEE, MMM d") : undefined}
              onClick={result.lowest ? () => scrollToDay(result.lowest!.date) : undefined} />
            <MetricCard title="Next Negative" value={result.firstNegative?.closingBalance ?? 0} type="warning"
              subtitle={result.firstNegative ? format(result.firstNegative.date, "EEE, MMM d") : undefined}
              onClick={result.firstNegative ? () => scrollToDay(result.firstNegative!.date) : undefined} />
            <MetricCard title="This Month" value={thisMonth?.netChange ?? 0}
              subtitle={`${formatCurrency(thisMonth?.totalIncome ?? 0)} in, ${formatCurrency(thisMonth?.totalExpenses ?? 0)} out`}
              type={(thisMonth?.netChange ?? 0) >= 0 ? "income" : "expense"} />
          </div>

          <div className="mt-4 text-foreground">
            <BalanceSparkline days={result.days} lowest={result.lowest} highest={result.highest} />
          </div>
        </CollapsibleTopSection>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Daily Transactions</h2>
          {result.days
            .filter((day) =>
              day.events.length > 0 ||
              (result.lowest && isSameDay(day.date, result.lowest.date)) ||
              (result.firstNegative && isSameDay(day.date, result.firstNegative.date)),
            )
            .map((day) => (
              <DailyCard key={day.date.toISOString()} day={day} onEventClick={openOverride} interactive={canEditOverrides} accountNames={accountNames} accountIds={accountIds} />
            ))}
        </div>

        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setMonthsAhead((m) => m + 1)}>Load next month</Button>
        </div>
      </div>

      {override && (
        <OverrideModal isOpen={!!override} {...override} onClose={() => setOverride(null)} />
      )}
    </Layout>
  );
}
