// app/budget/page.tsx
"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { formatCurrency } from "@/lib/design-system";
import { CategoryCombobox } from "@/app/particulars/CategoryCombobox";
import { buildBudget, type BudgetParticular } from "@/lib/budget/budget";
import { BudgetChart } from "./BudgetChart";
import { BudgetSummaryStats } from "./BudgetSummaryStats";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { useActiveAccount } from "@/app/_components/AccountContext";

type Particular = inferRouterOutputs<AppRouter>["particular"]["list"][number];

export default function BudgetPage() {
  const { accountId, activeMembership } = useActiveAccount();
  const canEditItems = !activeMembership || activeMembership.role === "OWNER" || activeMembership.canEditItems;
  const utils = trpc.useUtils();
  const { data: particulars = [], isLoading } = trpc.particular.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId },
  );
  const update = trpc.particular.update.useMutation({
    onSuccess: () => {
      utils.particular.list.invalidate();
      utils.category.list.invalidate();
      utils.forecast.getData.invalidate();
    },
  });
  const [expanded, setExpanded] = useState<string | null>(null);

  const expenses = particulars.filter((p) => p.type === "EXPENSE" && p.frequency !== "ONCE_OFF");
  const budgetInput: BudgetParticular[] = particulars.map((p) => ({
    type: p.type as "INCOME" | "EXPENSE",
    amount: Number(p.amount),
    frequency: p.frequency as BudgetParticular["frequency"],
    category: p.category,
  }));
  const summary = buildBudget(budgetInput);

  const retag = (p: Particular, category: string) => {
    update.mutate({
      accountId: accountId!,
      id: p.id,
      name: p.name,
      type: p.type as "INCOME" | "EXPENSE",
      amount: Math.abs(Number(p.amount)),
      frequency: p.frequency as BudgetParticular["frequency"],
      startDate: new Date(p.startDate),
      endDate: p.endDate ? new Date(p.endDate) : undefined,
      isCritical: p.isCritical,
      isFixed: p.isFixed,
      businessDayAdjustment: p.businessDayAdjustment as Particular["businessDayAdjustment"],
      category,
    });
  };

  const groupName = (name: string) =>
    name === "" ? "Untagged" : name;

  // Build display groups: each category + an Untagged bucket if present.
  const groups: { name: string; monthly: number; key: string }[] = [
    ...summary.categories.map((c) => ({ name: c.name, monthly: c.monthly, key: c.name })),
    ...(summary.untagged > 0 ? [{ name: "Untagged", monthly: summary.untagged, key: "" }] : []),
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Budget</h1>
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : expenses.length === 0 ? (
          <p className="text-muted-foreground">
            No recurring expenses yet. Add expenses and tag them with a category to see your budget.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[7fr_3fr]">
              <BudgetChart summary={summary} />
              <BudgetSummaryStats summary={summary} />
            </div>
            <div className="space-y-2">
              {groups.map((g) => {
                const items = expenses.filter((e) => (e.category ?? "") === g.key);
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
                            <span className="text-sm">{e.name}</span>
                            <CategoryCombobox
                              value={e.category ?? ""}
                              disabled={!canEditItems}
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
