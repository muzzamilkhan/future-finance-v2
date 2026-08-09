"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/trpc/client";
import { todayAsUtcDate } from "@/lib/dateInput";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Badge } from "@/app/_components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/_components/ui/select";
import { useFormatCurrency } from "@/app/_components/PreferencesContext";
import { ParticularForm } from "./ParticularForm";
import { TransferForm } from "./TransferForm";
import { QuickAddRow } from "./QuickAddRow";
import { CategoryPill } from "./CategoryPill";
import { frequencyLabel } from "./frequencyLabel";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { isTempId } from "@/lib/optimistic";
import { AccountBadge } from "@/app/_components/dashboard/AccountBadge";
import { ArrowRight, ArrowRightLeft, X } from "lucide-react";

type Particular = inferRouterOutputs<AppRouter>["particular"]["listAll"][number];

function byDate(a: Particular, b: Particular) {
  return a.startDate.getUTCDate() - b.startDate.getUTCDate();
}

export default function ParticularsPage() {
  const fmt = useFormatCurrency();
  const { accounts, defaultAccountId } = useActiveAccount();
  const defaultAccount = accounts.find((a) => a.id === defaultAccountId);
  const canEditItems = !defaultAccount || defaultAccount.role === "OWNER" || defaultAccount.canEditItems;
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
  const accountNames = useMemo(
    () => new Map((accountList ?? []).map((a) => [a.id, a.name] as const)),
    [accountList],
  );
  const accountIds = useMemo(() => (accountList ?? []).map((a) => a.id), [accountList]);
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
  const [transferOpen, setTransferOpen] = useState(false);

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
    const isTransfer = p.type === "TRANSFER";
    const signed = p.type === "EXPENSE" ? -Math.abs(Number(p.amount)) : Math.abs(Number(p.amount));
    const amountText = isTransfer ? fmt(Math.abs(Number(p.amount))) : fmt(signed);
    const amountClass = isTransfer ? "text-blue-600 dark:text-blue-400" : (signed < 0 ? "text-finance-expense" : "text-finance-income");
    const openEdit = () => {
      if (!p.canEditItems || isTempId(p.id)) return;
      setEditing(p.id);
      if (p.type === "TRANSFER") setTransferOpen(true); else setFormOpen(true);
    };
    const canMove = p.type !== "TRANSFER" && (accountList ?? []).some((a) => a.id !== defaultAccountId);
    // Fixed + critical items get no badge. Otherwise flag the flexible dimension:
    // !isCritical → the date can shift/skip ("Flexible"); !isFixed → the amount can vary ("Variable").
    const badges = (!p.isCritical || !p.isFixed) ? (
      <>
        {!p.isCritical && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">Flexible</Badge>
        )}
        {!p.isFixed && (
          <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-400">Variable</Badge>
        )}
      </>
    ) : null;
    return (
      <div
        key={p.id}
        role="button"
        tabIndex={0}
        onClick={openEdit}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEdit(); } }}
        className={`rounded-md border p-3${isTempId(p.id) ? " opacity-60 animate-pulse" : " cursor-pointer hover:bg-muted/50"}`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
            <div className="min-w-0 text-left">
              <span className="font-medium">{isTransfer ? "Transfer" : p.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{frequencyLabel(p, today)}</span>
            </div>
            {isTransfer ? (
              <span className="ml-2 inline-flex flex-wrap items-center gap-1">
                <AccountBadge accountId={p.accountId} accountNames={accountNames} orderedIds={accountIds} />
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
                <AccountBadge accountId={p.toAccountId!} accountNames={accountNames} orderedIds={accountIds} />
              </span>
            ) : (
              <AccountBadge accountId={p.accountId} accountNames={accountNames} orderedIds={accountIds} className="ml-2" />
            )}
            {badges && <span className="hidden items-center gap-1 sm:inline-flex">{badges}</span>}
            {p.type === "EXPENSE" && p.frequency !== "ONCE_OFF" && <CategoryPill particular={p} />}
            <span className={`ml-auto shrink-0 sm:hidden ${amountClass}`}>
              {amountText}
            </span>
          </div>
          <div className="flex items-center justify-end gap-2">
            {badges && <span className="mr-auto inline-flex items-center gap-1 sm:hidden">{badges}</span>}
            <span className={`hidden sm:inline ${amountClass}`}>
              {amountText}
            </span>
            {canMove && (
              <Button variant="ghost" size="icon-sm" aria-label="Move to another account"
                disabled={!p.canEditItems || isTempId(p.id)}
                onClick={(e) => { e.stopPropagation(); setMoveDest(""); setPendingMove(p); }}>
                <ArrowRightLeft className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Delete item"
              disabled={!p.canEditItems || isTempId(p.id)}
              onClick={(e) => { e.stopPropagation(); setPendingDelete(p); }}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
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
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!canEditItems} onClick={() => { setEditing(null); setFormOpen(true); }}>Add</Button>
            <Button size="sm" variant="outline" disabled={!canEditItems} onClick={() => { setEditing(null); setTransferOpen(true); }}>Add transfer</Button>
          </div>
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
        {transferOpen && (
          <TransferForm isOpen={transferOpen} particularId={editing} onClose={() => setTransferOpen(false)} />
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
                onClick={() => { if (pendingDelete) { del.mutate({ accountId: pendingDelete.accountId, id: pendingDelete.id }); setPendingDelete(null); } }}
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
                    .filter((a) => a.id !== defaultAccountId)
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
