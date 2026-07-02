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
import { DebtFormDialog } from "./DebtForm";
import { DebtCard } from "./DebtCard";
import { DebtForecastChart } from "./DebtForecastChart";
import { DebtTipsPanel } from "./DebtTipsPanel";

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

  const invalidate = () => utils.debt.list.invalidate();
  const create = trpc.debt.create.useMutation({ onSuccess: () => { setAdding(false); invalidate(); } });
  const update = trpc.debt.update.useMutation({ onSuccess: () => { setEditingId(null); invalidate(); } });
  const del = trpc.debt.delete.useMutation({ onSuccess: invalidate });

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
      <div className="grid gap-6">
        <div>
          <h1 className="text-2xl font-bold">Debt Buster</h1>
          <p className="text-sm text-muted-foreground">Plan your path to debt-free.</p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : debts.length === 0 ? (
          <Card className="grid gap-3 p-4">
            <p className="text-sm text-muted-foreground">No debts yet. Add your first to see a payoff forecast.</p>
            <Button onClick={() => setAdding(true)} className="justify-self-start">Add debt</Button>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-5">
            {/* Left: forecast + strategy + tips (80%) */}
            <div className="grid content-start gap-6 lg:col-span-4">
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
                <DebtForecastChart result={sims.active} />
              </Card>

              <DebtTipsPanel tips={tips} extraPayment={extraPayment} />
            </div>

            {/* Right: debt list (20%) */}
            <div className="grid content-start gap-3 lg:col-span-1">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Your debts</h2>
                <Button size="sm" onClick={() => setAdding(true)}>Add</Button>
              </div>
              {rows.map((d) => (
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
                  onDelete={() => del.mutate({ id: d.id })}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
