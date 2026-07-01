"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { particularInput, type ParticularInput, toParticularInput } from "@/lib/schemas";
import { dateToInputValue, inputValueToDate, todayAsUtcDate } from "@/lib/dateInput";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/app/_components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/app/_components/ui/select";
import { Label } from "@/app/_components/ui/label";
import { FormTabs, FormRow } from "./FormTabs";
import { addRow, updateRow, newTempId } from "@/lib/optimistic";

// See ParticularForm for why form values are typed by the schema's *input* side.
type TransferFormValues = z.input<typeof particularInput>;

export function TransferForm(
  { isOpen, particularId, onClose }: { isOpen: boolean; particularId: string | null; onClose: () => void },
) {
  const { accountId, accounts } = useActiveAccount();
  const [step, setStep] = useState(0);
  const utils = trpc.useUtils();
  const { data: existing } = trpc.particular.listAll.useQuery(undefined, {
    select: (rows) => rows.find((r) => r.id === particularId && r.direction === "OUT") ?? null,
    enabled: !!particularId,
  });
  const form = useForm<TransferFormValues>({
    resolver: zodResolver(particularInput),
    defaultValues: {
      name: "",
      type: "TRANSFER",
      amount: 0,
      frequency: "MONTHLY",
      startDate: todayAsUtcDate(),
      isCritical: true,
      isFixed: true,
      businessDayAdjustment: "NONE",
      category: "",
      accountId: accountId ?? undefined,
      toAccountId: undefined,
    },
    values: existing ? toParticularInput(existing) : undefined,
  });

  const onMutationError = (error: { message: string }, _vars: unknown, ctx?: { prev: unknown }) => {
    if (ctx) utils.particular.listAll.setData(undefined, ctx.prev as never);
    toast.error(particularId ? "Couldn't save changes" : "Couldn't add transfer", { description: error.message });
  };
  const onSettled = () => { utils.particular.listAll.invalidate(); utils.forecast.getData.invalidate(); };

  const create = trpc.particular.create.useMutation({
    onMutate: async (vars) => {
      await utils.particular.listAll.cancel();
      const prev = utils.particular.listAll.getData();
      const acct = accounts.find((a) => a.id === vars.accountId);
      utils.particular.listAll.setData(undefined, (old) =>
        addRow(old, {
          id: newTempId(),
          name: vars.name, type: vars.type, amount: vars.amount, frequency: vars.frequency,
          startDate: vars.startDate as Date, endDate: (vars.endDate as Date | undefined) ?? null,
          isCritical: vars.isCritical, isFixed: vars.isFixed,
          businessDayAdjustment: vars.businessDayAdjustment, category: vars.category ?? null,
          accountId: vars.accountId!, toAccountId: (vars.toAccountId as string | undefined) ?? null,
          accountName: acct?.name ?? "", direction: "OUT", canEditItems: true, overrides: [],
        } as never),
      );
      return { prev };
    },
    onError: onMutationError,
    onSettled,
  });
  const update = trpc.particular.update.useMutation({
    onMutate: async (vars) => {
      await utils.particular.listAll.cancel();
      const prev = utils.particular.listAll.getData();
      utils.particular.listAll.setData(undefined, (old) =>
        updateRow(old, vars.id, {
          name: vars.name, type: vars.type, amount: vars.amount, frequency: vars.frequency,
          startDate: vars.startDate as Date, endDate: (vars.endDate as Date | undefined) ?? null,
          isCritical: vars.isCritical, isFixed: vars.isFixed,
          businessDayAdjustment: vars.businessDayAdjustment, category: vars.category ?? null,
          toAccountId: (vars.toAccountId as string | undefined) ?? null,
        } as never),
      );
      return { prev };
    },
    onError: onMutationError,
    onSettled,
  });

  const submit = form.handleSubmit((values) => {
    if (particularId) {
      // Accounts are not editable on update; keep the transfer's existing from/to.
      update.mutate({
        ...values,
        accountId: existing?.accountId ?? accountId!,
        toAccountId: existing?.toAccountId ?? (values.toAccountId as string | undefined),
        id: particularId,
      });
    } else {
      create.mutate({ ...values, accountId: (values.accountId as string | undefined) || accountId! });
    }
    close();
  });

  const close = () => { setStep(0); onClose(); };

  const errors = form.formState.errors;
  const FieldError = ({ name }: { name: keyof TransferFormValues }) =>
    errors[name] ? <p className="text-xs text-destructive">{errors[name]?.message}</p> : null;

  const nameOf = (id: string | undefined) => accounts.find((a) => a.id === id)?.name ?? "";
  const fromId = (form.watch("accountId") as string | undefined) ?? accountId;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{particularId ? "Edit" : "Add"} transfer</DialogTitle></DialogHeader>
        <FormTabs tabs={["Details", "Options"]} active={step} onSelect={setStep} />
        <form className="space-y-3" onSubmit={submit}>
          <div className="min-h-[13.5rem]">
          <div className={step === 0 ? "space-y-3" : "hidden"}>
            <FormRow>
              <div className="space-y-1">
                <Label>From account</Label>
                {particularId ? (
                  <Input value={nameOf(existing?.accountId)} disabled readOnly />
                ) : (
                  <Select value={fromId ?? ""} onValueChange={(v) => form.setValue("accountId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {accounts.filter((a) => a.role === "OWNER" || a.canEditItems).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-1">
                <Label>To account</Label>
                {particularId ? (
                  <Input value={nameOf(existing?.toAccountId ?? undefined)} disabled readOnly />
                ) : (
                  <Select
                    value={(form.watch("toAccountId") as string | undefined) ?? ""}
                    onValueChange={(v) => form.setValue("toAccountId", v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                    <SelectContent>
                      {accounts.filter((a) => a.id !== fromId).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <FieldError name="toAccountId" />
              </div>
            </FormRow>
            <FormRow>
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input type="number" step="0.01" {...form.register("amount", { valueAsNumber: true })} />
                <FieldError name="amount" />
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
            </FormRow>
            <FormRow>
              <div className="space-y-1">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={dateToInputValue(form.watch("startDate") as Date | undefined)}
                  onChange={(e) => form.setValue("startDate", inputValueToDate(e.target.value), { shouldValidate: true })}
                />
                <FieldError name="startDate" />
              </div>
              <div />
            </FormRow>
          </div>

          <div className={step === 1 ? "space-y-3" : "hidden"}>
            <FormRow>
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
              <div className="space-y-1">
                <Label>End date (optional)</Label>
                <Input
                  type="date"
                  value={dateToInputValue(form.watch("endDate") as Date | undefined)}
                  onChange={(e) => form.setValue("endDate", inputValueToDate(e.target.value), { shouldValidate: true })}
                />
                <FieldError name="endDate" />
              </div>
            </FormRow>
          </div>
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            {step === 0 ? (
              <Button type="button" onClick={() => setStep(1)}>Next</Button>
            ) : (
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setStep(0)}>Back</Button>
                <Button type="submit">Save</Button>
              </div>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
