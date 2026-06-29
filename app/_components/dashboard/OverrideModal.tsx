"use client";

import { useState } from "react";
import { format } from "date-fns";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";

export function OverrideModal(
  { isOpen, particularId, originalDate, isFixed, isCritical, currentAmount, currentDate, onClose }:
  { isOpen: boolean; particularId: string; originalDate: Date; isFixed: boolean; isCritical: boolean; currentAmount: number; currentDate: Date; onClose: () => void },
) {
  const utils = trpc.useUtils();
  // Pre-populate with the occurrence's current values. Amount is stored signed in
  // the engine but overrides expect a positive magnitude (sign is applied from type).
  const [amount, setAmount] = useState(String(Math.abs(currentAmount)));
  const [date, setDate] = useState(format(currentDate, "yyyy-MM-dd"));
  const [skip, setSkip] = useState(false);
  const override = trpc.particular.overrideInstance.useMutation({
    onSuccess: () => { utils.forecast.getData.invalidate(); utils.particular.listOverrides.invalidate({ particularId }); onClose(); },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Override this occurrence</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          override.mutate({
            particularId, originalDate,
            // Only send fields the user can actually override for this particular —
            // the server rejects amount on fixed and date/skip on critical.
            overriddenAmount: !isFixed && amount ? Number(amount) : undefined,
            overriddenDate: !isCritical && date ? new Date(date) : undefined,
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
