"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createCreditAccountInput } from "@/lib/schemas";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/app/_components/ui/dialog";

type Values = z.input<typeof createCreditAccountInput>;

export function AddCreditAccountDialog(
  { isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated?: (id: string) => void },
) {
  const utils = trpc.useUtils();
  const form = useForm<Values>({
    resolver: zodResolver(createCreditAccountInput),
    defaultValues: { name: "Credit card", creditLimit: 0, outstanding: 0 },
  });
  const create = trpc.account.createCredit.useMutation({
    onSuccess: (r) => {
      utils.account.list.invalidate();
      utils.forecast.getCombined.invalidate();
      onCreated?.(r.id);
      form.reset();
      onClose();
    },
    onError: (e) => form.setError("name", { message: e.message }),
  });
  const submit = form.handleSubmit((values) => create.mutate(values));
  const errors = form.formState.errors;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add credit account</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1">
            <Label>Name</Label>
            <Input {...form.register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <Label>Credit limit</Label>
            <Input type="number" step="0.01" {...form.register("creditLimit", { valueAsNumber: true })} />
            {errors.creditLimit && <p className="text-xs text-destructive">{errors.creditLimit.message}</p>}
          </div>
          <div className="space-y-1">
            <Label>Current amount owed</Label>
            <Input type="number" step="0.01" {...form.register("outstanding", { valueAsNumber: true })} />
            {errors.outstanding && <p className="text-xs text-destructive">{errors.outstanding.message}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
