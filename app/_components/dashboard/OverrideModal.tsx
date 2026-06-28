"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";

export function OverrideModal(
  { isOpen, particularId, originalDate, isFixed, isCritical, onClose }:
  { isOpen: boolean; particularId: string; originalDate: Date; isFixed: boolean; isCritical: boolean; onClose: () => void },
) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
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
            overriddenAmount: amount ? Number(amount) : undefined,
            overriddenDate: date ? new Date(date) : undefined,
            isSkipped: skip,
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
