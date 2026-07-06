"use client";

import { useState } from "react";
import { dateToInputValue, inputValueToDate } from "@/lib/dateInput";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";
import { upsertRowBy, removeRow, newTempId } from "@/lib/optimistic";

export function OverrideModal(
  { isOpen, accountId, particularId, originalDate, isFixed, isCritical, currentAmount, currentDate, overrideId, onClose }:
  { isOpen: boolean; accountId: string; particularId: string; originalDate: Date; isFixed: boolean; isCritical: boolean; currentAmount: number; currentDate: Date; overrideId?: string; onClose: () => void },
) {
  const utils = trpc.useUtils();
  // Pre-populate with the occurrence's current values. Amount is stored signed in
  // the engine but overrides expect a positive magnitude (sign is applied from type).
  const [amount, setAmount] = useState(String(Math.abs(currentAmount)));
  const [date, setDate] = useState(dateToInputValue(currentDate));
  const [skip, setSkip] = useState(false);
  const settle = () => { utils.forecast.getCombined.invalidate(); utils.particular.listOverrides.invalidate({ accountId, particularId }); };
  const override = trpc.particular.overrideInstance.useMutation({
    onMutate: async (vars) => {
      const key = { accountId, particularId };
      await utils.particular.listOverrides.cancel(key);
      const prev = utils.particular.listOverrides.getData(key);
      const origTime = new Date(vars.originalDate as Date).getTime();
      utils.particular.listOverrides.setData(key, (old) =>
        upsertRowBy(
          old,
          (r) => new Date(r.originalDate).getTime() === origTime,
          {
            id: newTempId(),
            originalDate: vars.originalDate,
            overriddenAmount: vars.overriddenAmount ?? null,
            overriddenDate: vars.overriddenDate ?? null,
            isSkipped: vars.isSkipped ?? false,
          } as never,
        ),
      );
      onClose();
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.particular.listOverrides.setData(ctx.key, ctx.prev); },
    onSettled: settle,
  });
  const revert = trpc.particular.deleteOverride.useMutation({
    onMutate: async (vars) => {
      const key = { accountId, particularId };
      await utils.particular.listOverrides.cancel(key);
      const prev = utils.particular.listOverrides.getData(key);
      utils.particular.listOverrides.setData(key, (old) => removeRow(old, vars.id));
      onClose();
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.particular.listOverrides.setData(ctx.key, ctx.prev); },
    onSettled: settle,
  });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Override this occurrence</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          override.mutate({
            accountId,
            particularId, originalDate,
            // Only send fields the user can actually override for this particular —
            // the server rejects amount on fixed and date/skip on critical.
            overriddenAmount: !isFixed && amount ? Number(amount) : undefined,
            overriddenDate: !isCritical && date ? inputValueToDate(date) : undefined,
            isSkipped: !isCritical && skip,
          });
        }}>
          {!isFixed && (
            <div className="space-y-1">
              <label className="text-sm">New amount</label>
              <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          {!isCritical && (
            <>
              <div className="space-y-1">
                <label className="text-sm">Move to date</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={skip} onCheckedChange={(c) => setSkip(!!c)} /> Skip this occurrence
              </label>
            </>
          )}
          <div className="flex items-center justify-between gap-2">
            {overrideId ? (
              <Button type="button" variant="destructive"
                disabled={revert.isPending}
                onClick={() => revert.mutate({ accountId, id: overrideId })}>
                Revert override
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={override.isPending}>Save</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
