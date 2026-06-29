"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { particularInput, type ParticularInput } from "@/lib/schemas";
import { dateToInputValue, inputValueToDate } from "@/lib/dateInput";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/app/_components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/app/_components/ui/select";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { Label } from "@/app/_components/ui/label";

// `particularInput` is a refined (ZodEffects) schema, so its `input` type (what
// react-hook-form/zodResolver and tRPC's `.mutate()` actually expect — pre-coercion
// date fields are `unknown`) differs from `ParticularInput` (`z.infer`, the parsed
// *output* type with `startDate`/`endDate` as `Date`). Form values must be typed by
// the input side so the resolver and the mutation payload line up.
type ParticularFormValues = z.input<typeof particularInput>;

export function ParticularForm(
  { isOpen, particularId, onClose }: { isOpen: boolean; particularId: string | null; onClose: () => void },
) {
  const utils = trpc.useUtils();
  const { data: existing } = trpc.particular.list.useQuery(undefined, {
    select: (rows) => rows.find((r) => r.id === particularId) ?? null,
    enabled: !!particularId,
  });

  const form = useForm<ParticularFormValues>({
    resolver: zodResolver(particularInput),
    defaultValues: {
      name: existing?.name ?? "",
      type: (existing?.type as "INCOME" | "EXPENSE") ?? "EXPENSE",
      amount: existing ? Math.abs(Number(existing.amount)) : 0,
      frequency: (existing?.frequency as ParticularInput["frequency"]) ?? "MONTHLY",
      startDate: existing ? new Date(existing.startDate) : new Date(),
      isCritical: existing?.isCritical ?? true,
      isFixed: existing?.isFixed ?? true,
      businessDayAdjustment: (existing?.businessDayAdjustment as ParticularInput["businessDayAdjustment"]) ?? "NONE",
    },
    values: existing
      ? {
          name: existing.name,
          type: existing.type as "INCOME" | "EXPENSE",
          amount: Math.abs(Number(existing.amount)),
          frequency: existing.frequency as ParticularInput["frequency"],
          startDate: new Date(existing.startDate),
          endDate: existing.endDate ? new Date(existing.endDate) : undefined,
          isCritical: existing.isCritical,
          isFixed: existing.isFixed,
          businessDayAdjustment: existing.businessDayAdjustment as ParticularInput["businessDayAdjustment"],
        }
      : undefined,
  });

  const onDone = () => { utils.particular.list.invalidate(); utils.forecast.getData.invalidate(); onClose(); };
  const create = trpc.particular.create.useMutation({ onSuccess: onDone });
  const update = trpc.particular.update.useMutation({ onSuccess: onDone });

  const submit = form.handleSubmit((values) => {
    if (particularId) update.mutate({ ...values, id: particularId });
    else create.mutate(values);
  });

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{particularId ? "Edit" : "Add"} item</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div className="space-y-1">
            <Label>Name</Label>
            <Input {...form.register("name")} />
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={form.watch("type")} onValueChange={(v) => form.setValue("type", v as "INCOME" | "EXPENSE")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INCOME">Income</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Amount</Label>
            <Input type="number" step="0.01" {...form.register("amount", { valueAsNumber: true })} />
          </div>
          <div className="space-y-1">
            <Label>Frequency</Label>
            <Select value={form.watch("frequency")} onValueChange={(v) => form.setValue("frequency", v as ParticularInput["frequency"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ONCE_OFF">Once-off</SelectItem>
                <SelectItem value="WEEKLY">Weekly</SelectItem>
                <SelectItem value="FORTNIGHTLY">Fortnightly</SelectItem>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="ANNUAL">Annual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Start date</Label>
            <Input
              type="date"
              value={dateToInputValue(form.watch("startDate") as Date | undefined)}
              onChange={(e) => form.setValue("startDate", inputValueToDate(e.target.value), { shouldValidate: true })}
            />
          </div>
          <div className="space-y-1">
            <Label>End date (optional)</Label>
            <Input
              type="date"
              value={dateToInputValue(form.watch("endDate") as Date | undefined)}
              onChange={(e) => form.setValue("endDate", inputValueToDate(e.target.value), { shouldValidate: true })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.watch("isCritical")} onCheckedChange={(c) => form.setValue("isCritical", !!c)} />
            Critical (cannot be skipped or moved)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.watch("isFixed")} onCheckedChange={(c) => form.setValue("isFixed", !!c)} />
            Fixed (amount cannot be overridden)
          </label>
          <div className="space-y-1">
            <Label>Business-day adjustment</Label>
            <Select value={form.watch("businessDayAdjustment")} onValueChange={(v) => form.setValue("businessDayAdjustment", v as ParticularInput["businessDayAdjustment"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None</SelectItem>
                <SelectItem value="NEXT_BUSINESS_DAY">Next business day</SelectItem>
                <SelectItem value="PREVIOUS_BUSINESS_DAY">Previous business day</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
