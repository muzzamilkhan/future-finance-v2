"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { particularInput, type ParticularInput, toParticularInput } from "@/lib/schemas";
import { dateToInputValue, inputValueToDate, todayAsUtcDate } from "@/lib/dateInput";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { usePreferences } from "@/app/_components/PreferencesContext";
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
import { CategoryCombobox } from "./CategoryCombobox";
import { FormTabs, FormRow } from "./FormTabs";
import { addRow, updateRow, newTempId } from "@/lib/optimistic";

// `particularInput` is a refined (ZodEffects) schema, so its `input` type (what
// react-hook-form/zodResolver and tRPC's `.mutate()` actually expect — pre-coercion
// date fields are `unknown`) differs from `ParticularInput` (`z.infer`, the parsed
// *output* type with `startDate`/`endDate` as `Date`). Form values must be typed by
// the input side so the resolver and the mutation payload line up.
type ParticularFormValues = z.input<typeof particularInput>;

export function ParticularForm(
  { isOpen, particularId, onClose }: { isOpen: boolean; particularId: string | null; onClose: () => void },
) {
  const { defaultAccountId, accounts } = useActiveAccount();
  const { timeZone, isLoading: preferencesLoading } = usePreferences();
  const [step, setStep] = useState(0);
  const utils = trpc.useUtils();
  const { data: existing } = trpc.particular.listAll.useQuery(undefined, {
    select: (rows) => rows.find((r) => r.id === particularId && r.direction === "OUT") ?? null,
    enabled: !!particularId,
  });
  const form = useForm<ParticularFormValues>({
    resolver: zodResolver(particularInput),
    defaultValues: {
      name: existing?.name ?? "",
      type: (existing?.type as "INCOME" | "EXPENSE" | "TRANSFER") ?? "EXPENSE",
      amount: existing ? Math.abs(Number(existing.amount)) : 0,
      frequency: (existing?.frequency as ParticularInput["frequency"]) ?? "MONTHLY",
      startDate: existing ? new Date(existing.startDate) : todayAsUtcDate(timeZone),
      isCritical: existing?.isCritical ?? true,
      isFixed: existing?.isFixed ?? true,
      businessDayAdjustment: (existing?.businessDayAdjustment as ParticularInput["businessDayAdjustment"]) ?? "NONE",
      category: existing?.category ?? "",
      accountId: defaultAccountId ?? undefined,
    },
    values: existing ? toParticularInput(existing) : undefined,
  });

  // On a hard reload, preferences haven't resolved on the first render, so the
  // defaultValues above were seeded with the fallback (Sydney) timezone. Once the
  // real timeZone arrives, correct an untouched start date — but never for an edit
  // (the `values` prop above already wins there via `existing`) and never once the
  // user has touched the field themselves.
  useEffect(() => {
    if (particularId || preferencesLoading) return;
    if (form.formState.dirtyFields.startDate) return;
    form.setValue("startDate", todayAsUtcDate(timeZone));
  }, [particularId, preferencesLoading, timeZone, form]);

  const onMutationError = (error: { message: string }, _vars: unknown, ctx?: { prev: unknown }) => {
    if (ctx) utils.particular.listAll.setData(undefined, ctx.prev as never);
    toast.error(particularId ? "Couldn't save changes" : "Couldn't add item", { description: error.message });
  };
  const onSettled = () => { utils.particular.listAll.invalidate(); utils.forecast.getData.invalidate(); utils.category.invalidate(); };

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

  // Which tab each field lives on, so submit can jump to the first tab with an error.
  const fieldTab: Partial<Record<keyof ParticularFormValues, number>> = {
    accountId: 0, type: 0, name: 0, amount: 0, frequency: 0, startDate: 0,
    businessDayAdjustment: 1, endDate: 1, isCritical: 1, isFixed: 1, category: 1,
  };

  const submit = form.handleSubmit(
    (values) => {
      if (particularId) {
        // Account is not editable on update; keep the item on its existing account.
        update.mutate({ ...values, accountId: existing?.accountId ?? defaultAccountId!, id: particularId });
      } else {
        create.mutate({ ...values, accountId: (values.accountId as string | undefined) || defaultAccountId! });
      }
      close();
    },
    (errs) => {
      const tabs = Object.keys(errs).map((k) => fieldTab[k as keyof ParticularFormValues] ?? 0);
      if (tabs.length) setStep(Math.min(...tabs));
    },
  );

  const close = () => { setStep(0); onClose(); };

  const errors = form.formState.errors;
  const FieldError = ({ name }: { name: keyof ParticularFormValues }) =>
    errors[name] ? <p className="text-xs text-destructive">{errors[name]?.message}</p> : null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{particularId ? "Edit" : "Add"} item</DialogTitle></DialogHeader>
        <FormTabs tabs={["Details", "Options"]} active={step} onSelect={setStep} />
        <form className="space-y-3" onSubmit={submit}>
          <div className="min-h-[13.5rem]">
          <div className={step === 0 ? "space-y-3" : "hidden"}>
            <FormRow>
              <div className="space-y-1">
                <Label>Account</Label>
                {particularId ? (
                  <Input value={accounts.find((a) => a.id === existing?.accountId)?.name ?? ""} disabled readOnly />
                ) : (
                  <Select
                    value={(form.watch("accountId") as string | undefined) ?? defaultAccountId ?? ""}
                    onValueChange={(v) => form.setValue("accountId", v)}
                  >
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
                <Label>Type</Label>
                <Select value={form.watch("type")} onValueChange={(v) => form.setValue("type", v as "INCOME" | "EXPENSE")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INCOME">Income</SelectItem>
                    <SelectItem value="EXPENSE">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormRow>
            <FormRow>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input {...form.register("name")} />
                <FieldError name="name" />
              </div>
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input type="number" step="0.01" {...form.register("amount", { valueAsNumber: true })} />
                <FieldError name="amount" />
              </div>
            </FormRow>
            <FormRow>
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
                <FieldError name="startDate" />
              </div>
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
            <FormRow>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={form.watch("isCritical")} onCheckedChange={(c) => form.setValue("isCritical", !!c)} />
                <span>Critical <span className="text-muted-foreground">(cannot be skipped or moved)</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={form.watch("isFixed")} onCheckedChange={(c) => form.setValue("isFixed", !!c)} />
                <span>Fixed <span className="text-muted-foreground">(amount cannot be overridden)</span></span>
              </label>
            </FormRow>
            {form.watch("type") === "EXPENSE" && form.watch("frequency") !== "ONCE_OFF" && (
              <FormRow>
                <div className="space-y-1">
                  <Label>Category</Label>
                  <CategoryCombobox
                    allAccounts
                    value={(form.watch("category") as string | undefined) ?? ""}
                    onChange={(v) => form.setValue("category", v)}
                  />
                </div>
                <div />
              </FormRow>
            )}
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
