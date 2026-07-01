"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { todayAsUtcDate } from "@/lib/dateInput";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/_components/ui/select";
import { formatCurrency } from "@/lib/design-system";
import { ParticularForm } from "./ParticularForm";
import { OverrideManagement } from "./OverrideManagement";
import { QuickAddRow } from "./QuickAddRow";
import { CategoryPill } from "./CategoryPill";
import { frequencyLabel } from "./frequencyLabel";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { isTempId } from "@/lib/optimistic";

type Particular = inferRouterOutputs<AppRouter>["particular"]["listAll"][number];

function byDate(a: Particular, b: Particular) {
  return a.startDate.getUTCDate() - b.startDate.getUTCDate();
}

export default function ParticularsPage() {
  const { accountId, activeMembership } = useActiveAccount();
  const canEditItems = !activeMembership || activeMembership.role === "OWNER" || activeMembership.canEditItems;
  const utils = trpc.useUtils();
  const today = todayAsUtcDate();
  const { data: particulars, isLoading } = trpc.particular.listAll.useQuery();
  const [pendingDelete, setPendingDelete] = useState<Particular | null>(null);
  const del = trpc.particular.delete.useMutation({
    onMutate: async (vars) => {
      await utils.particular.listAll.cancel();
      const prev = utils.particular.listAll.getData();
      utils.particular.listAll.setData(undefined, (old) => (old ?? []).filter((r) => r.id !== vars.id));
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) utils.particular.listAll.setData(undefined, ctx.prev);
    },
    onSettled: () => { utils.particular.listAll.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const { data: accountList } = trpc.account.list.useQuery();
  const [pendingMove, setPendingMove] = useState<Particular | null>(null);
  const [moveDest, setMoveDest] = useState<string>("");

  const reassign = trpc.particular.reassignAccount.useMutation({
    onMutate: async (vars) => {
      await utils.particular.listAll.cancel();
      const prev = utils.particular.listAll.getData();
      utils.particular.listAll.setData(undefined, (old) => (old ?? []).filter((r) => r.id !== vars.id));
      return { prev };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.particular.listAll.setData(undefined, ctx.prev); },
    onSettled: () => {
      utils.particular.listAll.invalidate();
      utils.forecast.getData.invalidate();
      utils.forecast.getCombined.invalidate();
    },
  });

  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const all = particulars ?? [];
  const recurringTransfers = all
    .filter((p) => p.type === "TRANSFER" && p.frequency !== "ONCE_OFF")
    .sort(byDate);
  const recurringIncome = all
    .filter((p) => p.type === "INCOME" && p.frequency !== "ONCE_OFF")
    .sort(byDate);
  const recurringExpenses = all
    .filter((p) => p.type === "EXPENSE" && p.frequency !== "ONCE_OFF")
    .sort(byDate);
  const onceOffs = all.filter((p) => p.frequency === "ONCE_OFF");

  const renderRow = (p: Particular) => {
    const signed =
      p.type === "EXPENSE" ? -Math.abs(Number(p.amount))
      : p.type === "TRANSFER" ? (p.direction === "IN" ? Math.abs(Number(p.amount)) : -Math.abs(Number(p.amount)))
      : Math.abs(Number(p.amount));
    return (
      <div key={`${p.id}-${p.direction}`} className={`rounded-md border p-3${isTempId(p.id) ? " opacity-60 animate-pulse" : ""}`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
            <button className="min-w-0 text-left" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
              <span className="font-medium">{p.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{frequencyLabel(p, today)}</span>
            </button>
            <span className="ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {p.accountName}
            </span>
            {p.type === "EXPENSE" && <CategoryPill particular={p} />}
            <span className={`ml-auto shrink-0 sm:hidden ${signed < 0 ? "text-finance-expense" : "text-finance-income"}`}>
              {formatCurrency(signed)}
            </span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className={`hidden sm:inline ${signed < 0 ? "text-finance-expense" : "text-finance-income"}`}>
              {formatCurrency(signed)}
            </span>
            <Button variant="ghost" size="sm" disabled={!p.canEditItems || isTempId(p.id)} onClick={() => { setEditing(p.id); setFormOpen(true); }}>Edit</Button>
            {p.type !== "TRANSFER" && (accountList ?? []).some((a) => a.id !== accountId) && (
              <Button variant="ghost" size="sm" disabled={!p.canEditItems || isTempId(p.id)}
                onClick={() => { setMoveDest(""); setPendingMove(p); }}>Move</Button>
            )}
            <Button variant="ghost" size="sm" disabled={!p.canEditItems || isTempId(p.id)} onClick={() => setPendingDelete(p)}>Delete</Button>
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
          <Button size="sm" disabled={!canEditItems} onClick={() => { setEditing(null); setFormOpen(true); }}>Add</Button>
        </div>
        <QuickAddRow disabled={!canEditItems} />
        {isLoading ? <p className="text-muted-foreground">Loading...</p> : (
          <div className="space-y-6">
            {renderSection("Recurring Transfers", recurringTransfers)}
            {renderSection("Recurring Income", recurringIncome)}
            {renderSection("Recurring Expenses", recurringExpenses)}
            {renderSection("Once-offs", onceOffs)}
            {all.length === 0 && <p className="text-muted-foreground">No items yet. Add one above.</p>}
          </div>
        )}
        {formOpen && (
          <ParticularForm isOpen={formOpen} particularId={editing} onClose={() => setFormOpen(false)} />
        )}
        <Dialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !del.isPending) setPendingDelete(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete item?</DialogTitle>
              <DialogDescription>
                {pendingDelete
                  ? `"${pendingDelete.name}" will be permanently removed. This cannot be undone.`
                  : null}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={del.isPending} onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={del.isPending}
                onClick={() => { if (pendingDelete) del.mutate({ accountId: pendingDelete.accountId, id: pendingDelete.id }); }}
              >
                {del.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!pendingMove} onOpenChange={(o) => { if (!o && !reassign.isPending) setPendingMove(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Move to another account?</DialogTitle>
              <DialogDescription>
                {pendingMove
                  ? `"${pendingMove.name}" will be moved. All overrides on this item will be cleared.`
                  : null}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <Select value={moveDest} onValueChange={setMoveDest}>
                <SelectTrigger><SelectValue placeholder="Select destination account" /></SelectTrigger>
                <SelectContent>
                  {(accountList ?? [])
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={reassign.isPending} onClick={() => setPendingMove(null)}>Cancel</Button>
              <Button
                disabled={reassign.isPending || !moveDest}
                onClick={() => {
                  if (pendingMove && moveDest) {
                    reassign.mutate({ accountId: pendingMove.accountId, id: pendingMove.id, toAccountId: moveDest });
                    setPendingMove(null);
                  }
                }}
              >
                {reassign.isPending ? "Moving..." : "Move & clear overrides"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
