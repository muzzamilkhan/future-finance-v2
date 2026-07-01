// app/spending/page.tsx
"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { formatCurrency } from "@/lib/design-system";
import { CategoryCombobox } from "@/app/particulars/CategoryCombobox";
import { buildSpending, type SpendingParticular } from "@/lib/spending/spending";
import { SpendingChart } from "./SpendingChart";
import { SpendingSummaryStats } from "./SpendingSummaryStats";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { AccountBadge } from "@/app/_components/dashboard/AccountBadge";
import { updateRow } from "@/lib/optimistic";

type ListAllRow = inferRouterOutputs<AppRouter>["particular"]["listAll"][number];

export default function SpendingPage() {
  const utils = trpc.useUtils();
  // Spending combines every account the user can see, excluding transfers.
  const { data: rows = [], isLoading } = trpc.particular.listAll.useQuery();
  const { data: accountList } = trpc.account.list.useQuery();
  const accountNames = useMemo(
    () => new Map((accountList ?? []).map((a) => [a.id, a.name] as const)),
    [accountList],
  );
  const accountIds = useMemo(() => (accountList ?? []).map((a) => a.id), [accountList]);

  const update = trpc.particular.update.useMutation({
    onMutate: async (vars) => {
      await utils.particular.listAll.cancel();
      const prev = utils.particular.listAll.getData();
      utils.particular.listAll.setData(undefined, (old) =>
        updateRow(old, vars.id, { category: vars.category ?? null } as never),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) utils.particular.listAll.setData(undefined, ctx.prev);
    },
    onSettled: () => {
      utils.particular.listAll.invalidate();
      utils.category.list.invalidate();
      utils.category.listAll.invalidate();
      utils.forecast.getData.invalidate();
      utils.forecast.getCombined.invalidate();
    },
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  // Spending only counts recurring expenses; once-offs are never factored in.
  const expenses = rows.filter((p) => p.type === "EXPENSE" && p.frequency !== "ONCE_OFF");
  const untaggedItems = expenses.filter((p) => !p.category);
  const spendingInput: SpendingParticular[] = rows.map((p) => ({
    type: p.type,
    amount: Number(p.amount),
    frequency: p.frequency as SpendingParticular["frequency"],
    category: p.category,
  }));
  const summary = buildSpending(spendingInput);

  const retag = (p: ListAllRow, category: string) => {
    update.mutate({
      accountId: p.accountId,
      id: p.id,
      name: p.name,
      type: p.type as "INCOME" | "EXPENSE",
      amount: Math.abs(Number(p.amount)),
      frequency: p.frequency as SpendingParticular["frequency"],
      startDate: new Date(p.startDate),
      endDate: p.endDate ? new Date(p.endDate) : undefined,
      isCritical: p.isCritical,
      isFixed: p.isFixed,
      businessDayAdjustment: p.businessDayAdjustment,
      category,
    });
  };

  const groupName = (name: string) =>
    name === "" ? "Untagged" : name;

  // Build display groups: each recurring category + an Untagged bucket whenever any
  // recurring uncategorized expense exists.
  const groups: { name: string; monthly: number; key: string }[] = [
    ...summary.categories.map((c) => ({ name: c.name, monthly: c.monthly, key: c.name })),
    ...(untaggedItems.length > 0 ? [{ name: "Untagged", monthly: summary.untagged, key: "" }] : []),
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Spending</h1>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : expenses.length === 0 ? (
          <p className="text-muted-foreground">
            No recurring expenses yet. Add expenses and tag them with a category to see your spending.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[7fr_3fr]">
              <SpendingChart summary={summary} />
              <SpendingSummaryStats summary={summary} />
            </div>
            <div className="space-y-2">
              {groups.map((g) => {
                // Untagged lists recurring uncategorized expenses;
                // category groups list their recurring members.
                const items = g.key === ""
                  ? untaggedItems
                  : expenses.filter((e) => (e.category ?? "") === g.key);
                return (
                  <div key={g.key || "untagged"} className="rounded-md border p-3">
                    <button
                      className="flex w-full items-center justify-between text-left"
                      onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                    >
                      <span className="font-medium">{groupName(g.name)}</span>
                      <span className="text-finance-expense">{formatCurrency(g.monthly)}/mo</span>
                    </button>
                    {expanded === g.key && (
                      <div className="mt-3 space-y-2">
                        {items.map((e) => (
                          <div key={e.id} className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2 text-sm">
                              {e.name}
                              <AccountBadge
                                accountId={e.accountId}
                                accountNames={accountNames}
                                orderedIds={accountIds}
                              />
                            </span>
                            <CategoryCombobox
                              value={e.category ?? ""}
                              disabled={!e.canEditItems}
                              allAccounts
                              onChange={(v) => { if (v !== (e.category ?? "")) retag(e, v); }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
