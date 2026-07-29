"use client";

import { useMemo, useState } from "react";
import { isSameDay } from "date-fns";
import { dateToInputValue, formatUtcMonthDay, formatUtcWeekdayMonthDay } from "@/lib/dateInput";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/trpc/client";
import { computeForecast } from "@/lib/engine";
import { toCombinedEngineInputs } from "@/lib/toEngine";
import { computeThisMonthSummary } from "@/app/_components/dashboard/thisMonthSummary";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { MetricCard } from "@/app/_components/dashboard/MetricCard";
import { AccountBalanceList } from "@/app/_components/dashboard/AccountBalanceList";
import { AccountLowList } from "@/app/_components/dashboard/AccountLowList";
import { DailyCard } from "@/app/_components/dashboard/DailyCard";
import { AccountBadge } from "@/app/_components/dashboard/AccountBadge";
import { DangerNotification } from "@/app/_components/dashboard/DangerNotification";
import { SkipTodayButton } from "@/app/_components/dashboard/SkipTodayButton";
import { BalanceSparkline } from "@/app/_components/dashboard/BalanceSparkline";
import { OverrideModal } from "@/app/_components/dashboard/OverrideModal";
import { CollapsibleTopSection } from "@/app/_components/dashboard/CollapsibleTopSection";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { updateRow } from "@/lib/optimistic";

export function DashboardPage() {
  // UTC midnight of the *local* calendar date. The engine keys every day by its
  // UTC components (utcDay), so passing local startOfDay in a positive-UTC-offset
  // timezone would land the window one calendar day early. Anchoring to UTC
  // midnight of the local date keeps "today" as the first daily card.
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const [monthsAhead, setMonthsAhead] = useState(6);
  const [override, setOverride] = useState<{ accountId: string; particularId: string; originalDate: Date; isFixed: boolean; isCritical: boolean; currentAmount: number; currentDate: Date; overrideId?: string } | null>(null);

  // Add months in UTC so the window bound can't drift across a DST boundary (date-fns
  // addMonths works on local wall-clock; on our UTC-midnight `today` that could land
  // on an adjacent UTC day when the offset changes). The engine compares in UTC.
  const viewEnd = new Date(Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth() + monthsAhead, today.getUTCDate(),
  ));

  const { defaultAccountId, accounts } = useActiveAccount();
  const activeMembership = accounts.find((a) => a.id === defaultAccountId) ?? null;
  const canUpdateBalance = !activeMembership || activeMembership.role === "OWNER" || activeMembership.canUpdateBalance;
  const canEditOverrides = !activeMembership || activeMembership.role === "OWNER" || activeMembership.canEditOverrides;
  const utils = trpc.useUtils();
  // Query window starts at today and never shifts with skip-today, so toggling skip
  // doesn't refetch — the skip is purely a client-side recompute.
  const queryKey = { viewStart: today, viewEnd };
  const { data, isLoading } = trpc.forecast.getCombined.useQuery(
    queryKey,
    { placeholderData: keepPreviousData },
  );

  // "Skip today" is remembered server-side as the local date the user chose to skip.
  // It counts only while that stored date still equals the user's current local date,
  // so it survives reloads but resets automatically at local midnight.
  const skipToday = !!data?.skipTodayDate && new Date(data.skipTodayDate).getTime() === today.getTime();
  const setSkipToday = trpc.forecast.setSkipToday.useMutation({
    onMutate: async (vars) => {
      await utils.forecast.getCombined.cancel(queryKey);
      const prev = utils.forecast.getCombined.getData(queryKey);
      utils.forecast.getCombined.setData(queryKey, (old) =>
        old ? { ...old, skipTodayDate: vars.date } : old,
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.forecast.getCombined.setData(queryKey, ctx.prev); },
    onSettled: () => { utils.forecast.getCombined.invalidate(); },
  });
  const toggleSkipToday = () => setSkipToday.mutate({ date: skipToday ? null : today });

  // Skip-today shifts the visible window to tomorrow; the engine also drops today's
  // events from the running balance via skipToday. The daily list then starts at
  // tomorrow instead of today.
  const viewStart = skipToday ? tomorrow : today;
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
      .getElementById(`day-${dateToInputValue(date)}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const result = useMemo(() => {
    if (!data) return null;
    const inputs = toCombinedEngineInputs(data as never, today);
    return computeForecast({ ...inputs, viewStart, viewEnd, today, skipToday });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, monthsAhead, skipToday]);

  // Full-calendar-month view for the "This Month" widget: reverse-replay events
  // already applied earlier this month to recover the start-of-month balance, and
  // forward-replay the rest to project the end-of-month balance.
  const thisMonth = useMemo(() => {
    if (!data) return null;
    const inputs = toCombinedEngineInputs(data as never, today);
    return computeThisMonthSummary({ ...inputs, today, skipToday });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, skipToday]);

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

  // Sum of the per-account shortfalls shown in the footer: each account's figure at
  // its own first-exhaustion day (available credit for CREDIT, cash balance otherwise).
  // These are negative when short; 0 means no account is ever exhausted.
  const combinedShortfall = result.exhaustions.reduce(
    (sum, ex) => sum + (ex.type === "CREDIT" ? (ex.availableCredit ?? 0) : ex.balance),
    0,
  );

  const openOverride = (particularId: string, originalDate?: Date, currentAmount?: number, currentDate?: Date, overrideId?: string) => {
    if (!canEditOverrides) return;
    if (!originalDate || currentAmount === undefined || !currentDate) return;
    // Look the particular up in the combined forecast payload, which spans every
    // account the user can see — NOT a single-account list. The dashboard is a
    // combined view, so an event may belong to any of the user's accounts, and the
    // override must be scoped to that particular's own account.
    const p = data?.particulars.find((x) => x.id === particularId);
    if (!p) return;
    // Fixed + critical occurrences have nothing the user can override
    // (amount needs !isFixed; date/skip needs !isCritical). Don't open the modal.
    if (p.isFixed && p.isCritical) return;
    setOverride({ accountId: p.accountId, particularId, originalDate, isFixed: p.isFixed, isCritical: p.isCritical, currentAmount, currentDate, overrideId });
  };

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex gap-2">
            <SkipTodayButton skipToday={skipToday} onToggle={toggleSkipToday} />
          </div>
        </div>

        {result.firstNegative && <DangerNotification negativeBalance={result.firstNegative} />}

        <CollapsibleTopSection
          compact={
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{formatCurrency(current)}</span>
              {result.lowest && (
                <span className="text-muted-foreground">
                  Low {formatCurrency(result.lowest.closingBalance)} · {formatUtcMonthDay(result.lowest.date)}
                </span>
              )}
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
            <MetricCard title="Current Balance" value={current} type={current >= 0 ? "income" : "expense"}
              editable={canUpdateBalance && accounts.length <= 1}
              onSave={(balance) => updateBalance.mutate({ accountId: defaultAccountId!, balance })}
              footer={
                <AccountBalanceList
                  accounts={accounts}
                  onSave={(id, balance) => updateBalance.mutate({ accountId: id, balance })}
                />
              } />
            <MetricCard title="Lowest Balance" value={result.lowest?.closingBalance ?? 0}
              type={(result.lowest?.closingBalance ?? 0) >= 0 ? "income" : "expense"}
              subtitle={result.lowest ? formatUtcWeekdayMonthDay(result.lowest.date) : undefined}
              onClick={result.lowest ? () => scrollToDay(result.lowest!.date) : undefined}
              footer={
                <AccountLowList
                  accounts={accounts}
                  lows={result.lowestByAccount}
                  onSelect={(date) => scrollToDay(date)}
                />
              } />
            <MetricCard title="Combined Shortfall" value={combinedShortfall}
              valueDisplay={combinedShortfall < 0 ? formatCurrency(combinedShortfall) : "None"}
              type={combinedShortfall < 0 ? "expense" : "income"}
              subtitle={result.firstNegative ? formatUtcWeekdayMonthDay(result.firstNegative.date) : undefined}
              onClick={result.firstNegative ? () => scrollToDay(result.firstNegative!.date) : undefined}
              footer={
                result.exhaustions.length > 0 ? (
                  <ul className="space-y-1">
                    {result.exhaustions.map((ex) => (
                      <li key={ex.accountId}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); scrollToDay(ex.date); }}
                          className="flex w-full items-center justify-between gap-1 text-left text-xs"
                        >
                          <span className="flex items-center gap-1">
                            <AccountBadge accountId={ex.accountId} accountNames={accountNames} orderedIds={accountIds} className="px-1.5 py-0 text-[10px]" />
                            <span className="text-muted-foreground">{formatUtcWeekdayMonthDay(ex.date)}</span>
                          </span>
                          <span className="shrink-0 text-finance-expense">
                            {formatCurrency(ex.type === "CREDIT" ? (ex.availableCredit ?? 0) : ex.balance)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : undefined
              } />
            <MetricCard title="This Month" value={thisMonth?.netChange ?? 0}
              subtitle={`${formatCurrency(thisMonth?.totalIncome ?? 0)} in, ${formatCurrency(thisMonth?.totalExpenses ?? 0)} out`}
              type={(thisMonth?.netChange ?? 0) >= 0 ? "income" : "expense"}
              footer={
                thisMonth ? (
                  <dl className="mt-1 space-y-0.5 text-xs">
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Start</dt>
                      <dd>{formatCurrency(thisMonth.startBalance)}</dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="text-muted-foreground">Projected end</dt>
                      <dd className={thisMonth.endBalance >= 0 ? "text-finance-income" : "text-finance-expense"}>
                        {formatCurrency(thisMonth.endBalance)}
                      </dd>
                    </div>
                  </dl>
                ) : undefined
              } />
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
