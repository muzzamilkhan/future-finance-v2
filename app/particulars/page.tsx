"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { ParticularForm } from "./ParticularForm";
import { OverrideManagement } from "./OverrideManagement";
import { QuickAddRow } from "./QuickAddRow";
import { CategoryPill } from "./CategoryPill";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { useActiveAccount } from "@/app/_components/AccountContext";

type Particular = inferRouterOutputs<AppRouter>["particular"]["list"][number];

// Recurring frequencies, ordered annual → weekly for display.
const FREQUENCY_RANK: Record<string, number> = {
  ANNUAL: 0, MONTHLY: 1, FORTNIGHTLY: 2, WEEKLY: 3,
};

function byFrequency(a: Particular, b: Particular) {
  return (FREQUENCY_RANK[a.frequency] ?? 99) - (FREQUENCY_RANK[b.frequency] ?? 99);
}

export default function ParticularsPage() {
  const { accountId } = useActiveAccount();
  const utils = trpc.useUtils();
  const { data: particulars, isLoading } = trpc.particular.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId },
  );
  const del = trpc.particular.delete.useMutation({
    onSuccess: () => { utils.particular.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const all = particulars ?? [];
  const recurringIncome = all
    .filter((p) => p.type === "INCOME" && p.frequency !== "ONCE_OFF")
    .sort(byFrequency);
  const recurringExpenses = all
    .filter((p) => p.type === "EXPENSE" && p.frequency !== "ONCE_OFF")
    .sort(byFrequency);
  const onceOffs = all.filter((p) => p.frequency === "ONCE_OFF");

  const renderRow = (p: Particular) => {
    const signed = p.type === "EXPENSE" ? -Math.abs(Number(p.amount)) : Math.abs(Number(p.amount));
    return (
      <div key={p.id} className="rounded-md border p-3">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <button className="text-left" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
              <span className="font-medium">{p.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{p.frequency}</span>
            </button>
            {p.type === "EXPENSE" && <CategoryPill particular={p} />}
          </div>
          <div className="flex items-center gap-2">
            <span className={signed < 0 ? "text-finance-expense" : "text-finance-income"}>
              {formatCurrency(signed)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(p.id); setFormOpen(true); }}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={() => del.mutate({ accountId: accountId!, id: p.id })}>Delete</Button>
          </div>
        </div>
        {expanded === p.id && <div className="mt-2"><OverrideManagement particularId={p.id} /></div>}
      </div>
    );
  };

  const renderSection = (title: string, items: Particular[]) =>
    items.length === 0 ? null : (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
        {items.map(renderRow)}
      </section>
    );

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Income &amp; Expenses</h1>
          <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>Add</Button>
        </div>
        <QuickAddRow />
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : (
          <div className="space-y-6">
            {renderSection("Recurring Income", recurringIncome)}
            {renderSection("Recurring Expenses", recurringExpenses)}
            {renderSection("Once-offs", onceOffs)}
            {all.length === 0 && <p className="text-muted-foreground">No items yet. Add one above.</p>}
          </div>
        )}
        {formOpen && (
          <ParticularForm isOpen={formOpen} particularId={editing} onClose={() => setFormOpen(false)} />
        )}
      </div>
    </Layout>
  );
}
