"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import {
  simulateDebtPayoff,
  deriveTips,
  type DebtInput,
  type Strategy,
} from "@/lib/engine";
import { formatCurrency } from "@/lib/design-system";
import { Card } from "@/app/_components/ui/card";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";
import { DebtFormDialog } from "./DebtForm";
import { DebtCard } from "./DebtCard";
import { DebtForecastChart } from "./DebtForecastChart";
import { DebtTipsPanel } from "./DebtTipsPanel";
import { addRow, removeRow, newTempId } from "@/lib/optimistic";
import { moveItem } from "./moveItem";
import { toast } from "sonner";

const STRATEGIES: { value: Strategy; label: string }[] = [
  { value: "SNOWBALL", label: "Snowball" },
  { value: "AVALANCHE", label: "Avalanche" },
  { value: "CUSTOM", label: "Custom" },
];

function monthsLabel(payoffMonth: number | null) {
  if (payoffMonth === null) return "Never (raise payments)";
  return `${payoffMonth} ${payoffMonth === 1 ? "month" : "months"}`;
}

export default function DebtsPage() {
  const utils = trpc.useUtils();
  const { data: rows = [], isLoading } = trpc.debt.list.useQuery();

  const [strategy, setStrategy] = useState<Strategy>("AVALANCHE");
  const [extraStr, setExtraStr] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const invalidate = () => utils.debt.list.invalidate();

  const create = trpc.debt.create.useMutation({
    onMutate: async (vars) => {
      setAdding(false);
      await utils.debt.list.cancel();
      const prev = utils.debt.list.getData();
      const now = new Date();
      const maxSort = (prev ?? []).reduce((m, d) => Math.max(m, d.sortOrder), -1);
      utils.debt.list.setData(undefined, (old) =>
        addRow(old, {
          id: newTempId(),
          userId: "",
          name: vars.name,
          balance: vars.balance,
          apr: vars.apr,
          minPayment: vars.minPayment,
          sortOrder: maxSort + 1,
          createdAt: now,
          updatedAt: now,
        } as never),
      );
      return { prev };
    },
    onError: (error, vars, ctx) => {
      if (ctx) utils.debt.list.setData(undefined, ctx.prev);
      toast.error(`Couldn't add "${vars.name}"`, { description: error.message });
    },
    onSettled: () => invalidate(),
  });

  const update = trpc.debt.update.useMutation({ onSuccess: () => { setEditingId(null); invalidate(); } });

  const reorder = trpc.debt.reorder.useMutation({
    onMutate: async (vars) => {
      await utils.debt.list.cancel();
      const prev = utils.debt.list.getData();
      utils.debt.list.setData(undefined, (old) => {
        if (!old) return old;
        const byId = new Map(old.map((d) => [d.id, d] as const));
        return vars.ids.map((id) => byId.get(id)!).filter(Boolean);
      });
      return { prev };
    },
    onError: (error, _vars, ctx) => {
      if (ctx) utils.debt.list.setData(undefined, ctx.prev);
      toast.error("Couldn't reorder debts", { description: error.message });
    },
    onSettled: () => invalidate(),
  });

  const move = (id: string, direction: "up" | "down") => {
    const ids = rows.map((d) => d.id);
    const idx = ids.indexOf(id);
    const nextIds = moveItem(ids, idx, direction);
    if (nextIds === ids) return;
    reorder.mutate({ ids: nextIds });
  };

  const del = trpc.debt.delete.useMutation({
    onMutate: async (vars) => {
      setPendingDelete(null);
      await utils.debt.list.cancel();
      const prev = utils.debt.list.getData();
      utils.debt.list.setData(undefined, (old) => removeRow(old, vars.id));
      return { prev };
    },
    onError: (error, _vars, ctx) => {
      if (ctx) utils.debt.list.setData(undefined, ctx.prev);
      toast.error("Couldn't delete debt", { description: error.message });
    },
    onSettled: () => invalidate(),
  });

  const debts: DebtInput[] = useMemo(
    () => rows.map((d) => ({
      id: d.id,
      name: d.name,
      balance: Number(d.balance),
      apr: Number(d.apr),
      minPayment: Number(d.minPayment),
    })),
    [rows],
  );
  const customOrder = useMemo(() => debts.map((d) => d.id), [debts]);
  const extraPayment = Math.max(0, Number(extraStr) || 0);

  const sims = useMemo(() => {
    const run = (s: Strategy, extra: number) =>
      simulateDebtPayoff({ debts, strategy: s, extraPayment: extra, customOrder });
    const snowball = run("SNOWBALL", extraPayment);
    const avalanche = run("AVALANCHE", extraPayment);
    const active = run(strategy, extraPayment);
    const activeNoExtra = run(strategy, 0);
    const custom = run("CUSTOM", extraPayment);
    return { snowball, avalanche, active, activeNoExtra, custom };
  }, [debts, customOrder, strategy, extraPayment]);

  const tips = useMemo(
    () => deriveTips({
      debts, activeStrategy: strategy, customOrder,
      snowball: sims.snowball, avalanche: sims.avalanche,
      active: sims.active, activeNoExtra: sims.activeNoExtra,
    }),
    [debts, strategy, customOrder, sims],
  );

  const totalOwed = debts.reduce((s, d) => s + d.balance, 0);
  const totalMin = debts.reduce((s, d) => s + d.minPayment, 0);

  const editingRow = editingId ? rows.find((d) => d.id === editingId) : undefined;

  return (
    <Layout>
      <DebtFormDialog
        open={adding}
        onSubmit={(v) => create.mutate(v)}
        onClose={() => setAdding(false)}
        submitting={create.isPending}
      />
      {editingRow && (
        <DebtFormDialog
          open={!!editingRow}
          initial={{
            name: editingRow.name,
            balance: Number(editingRow.balance),
            aprPercent: Number(editingRow.apr) * 100,
            minPayment: Number(editingRow.minPayment),
          }}
          onSubmit={(v) => update.mutate({ id: editingRow.id, ...v })}
          onClose={() => setEditingId(null)}
          submitting={update.isPending}
        />
      )}
      <Dialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !del.isPending) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete debt?</DialogTitle>
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
              onClick={() => { if (pendingDelete) del.mutate({ id: pendingDelete.id }); }}
            >
              {del.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="grid gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Debt Buster</h1>
            <p className="text-sm text-muted-foreground">Plan your path to debt-free.</p>
          </div>
          <Button size="sm" onClick={() => setAdding(true)}>Add</Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : debts.length === 0 ? (
          <Card className="grid gap-3 p-4">
            <p className="text-sm text-muted-foreground">No debts yet. Add your first to see a payoff forecast.</p>
            <Button onClick={() => setAdding(true)} className="justify-self-start">Add debt</Button>
          </Card>
        ) : (
          <>
            {/* Summary widgets: own full-width row */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-xs text-muted-foreground">Total owed</p>
                <p className="text-xl font-bold">{formatCurrency(totalOwed)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground">Minimums / mo</p>
                <p className="text-xl font-bold">{formatCurrency(totalMin)}</p>
              </Card>
              <Card className="p-4">
                <p className="text-xs text-muted-foreground">Debt-free in</p>
                <p className="text-xl font-bold">{monthsLabel(sims.active.payoffMonth)}</p>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Left: forecast + strategy + tips (2/3) */}
              <div className="grid content-start gap-6 lg:col-span-2">
                <Card className="grid gap-4 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {STRATEGIES.map((s) => (
                      <Button
                        key={s.value}
                        type="button"
                        variant={strategy === s.value ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStrategy(s.value)}
                      >
                        {s.label} · {monthsLabel(
                          s.value === "SNOWBALL" ? sims.snowball.payoffMonth
                          : s.value === "AVALANCHE" ? sims.avalanche.payoffMonth
                          : sims.custom.payoffMonth,
                        )}
                      </Button>
                    ))}
                  </div>
                  <div className="grid max-w-xs gap-1">
                    <Label htmlFor="extra">Extra payment / mo</Label>
                    <Input
                      id="extra"
                      inputMode="decimal"
                      value={extraStr}
                      onChange={(e) => setExtraStr(e.target.value)}
                    />
                  </div>
                  <DebtForecastChart result={sims.active} debts={debts} />
                </Card>

                <DebtTipsPanel tips={tips} extraPayment={extraPayment} />
              </div>

              {/* Right: debt list (1/3) */}
              <div className="grid content-start gap-3 lg:col-span-1">
                {rows.map((d, i) => (
                  <DebtCard
                    key={d.id}
                    debt={{
                      id: d.id,
                      name: d.name,
                      balance: Number(d.balance),
                      apr: Number(d.apr),
                      minPayment: Number(d.minPayment),
                    }}
                    onEdit={() => setEditingId(d.id)}
                    onDelete={() => setPendingDelete({ id: d.id, name: d.name })}
                    onMoveUp={() => move(d.id, "up")}
                    onMoveDown={() => move(d.id, "down")}
                    canMoveUp={i > 0}
                    canMoveDown={i < rows.length - 1}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
