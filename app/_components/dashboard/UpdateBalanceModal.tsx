"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";

export function UpdateBalanceModal(
  { isOpen, current, onClose }: { isOpen: boolean; current: number; onClose: () => void },
) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(String(current));
  const update = trpc.account.updateBalance.useMutation({
    onSuccess: () => { utils.account.get.invalidate(); utils.forecast.getData.invalidate(); onClose(); },
  });
  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Update current balance</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); update.mutate({ balance: Number(value) }); }}>
          <Input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
