"use client";

import { useState } from "react";
import { debtInputSchema, type DebtInputSchema } from "@/lib/schemas";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";

import { parseNumericInput } from "./parseNumericInput";

type Initial = { name: string; balance: number; aprPercent: number; minPayment: number };

export function DebtForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial?: Initial;
  onSubmit: (v: DebtInputSchema) => void;
  onCancel?: () => void;
  submitting?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [balance, setBalance] = useState(initial?.balance != null ? String(initial.balance) : "");
  const [aprPercent, setAprPercent] = useState(initial?.aprPercent != null ? String(initial.aprPercent) : "");
  const [minPayment, setMinPayment] = useState(initial?.minPayment != null ? String(initial.minPayment) : "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = debtInputSchema.safeParse({
      name,
      balance: parseNumericInput(balance),
      apr: parseNumericInput(aprPercent) / 100,
      minPayment: parseNumericInput(minPayment),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid debt");
      return;
    }
    setError(null);
    onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid gap-1">
        <Label htmlFor="debt-name">Name</Label>
        <Input id="debt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Visa" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-1">
          <Label htmlFor="debt-balance">Balance</Label>
          <Input id="debt-balance" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="debt-apr">APR %</Label>
          <Input id="debt-apr" inputMode="decimal" value={aprPercent} onChange={(e) => setAprPercent(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="debt-min">Min / mo</Label>
          <Input id="debt-min" inputMode="decimal" value={minPayment} onChange={(e) => setMinPayment(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-sm text-finance-expense">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>{initial ? "Save" : "Add debt"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

/** DebtForm rendered inside a modal dialog. */
export function DebtFormDialog({
  open,
  initial,
  onSubmit,
  onClose,
  submitting,
}: {
  open: boolean;
  initial?: Initial;
  onSubmit: (v: DebtInputSchema) => void;
  onClose: () => void;
  submitting?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? "Edit debt" : "Add debt"}</DialogTitle>
        </DialogHeader>
        <DebtForm initial={initial} onSubmit={onSubmit} onCancel={onClose} submitting={submitting} />
      </DialogContent>
    </Dialog>
  );
}
