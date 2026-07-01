"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { particularInput } from "@/lib/schemas";
import { dateToInputValue, inputValueToDate, todayAsUtcDate } from "@/lib/dateInput";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { addRow, newTempId } from "@/lib/optimistic";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/app/_components/ui/select";

type QuickAddValues = z.input<typeof particularInput>;
type Frequency = QuickAddValues["frequency"];

const defaults = (): QuickAddValues => ({
  name: "",
  type: "EXPENSE",
  amount: 0,
  frequency: "MONTHLY",
  startDate: todayAsUtcDate(),
  isCritical: true,
  isFixed: true,
  businessDayAdjustment: "NONE",
});

export function QuickAddRow({ disabled }: { disabled?: boolean }) {
  const { accountId, accounts } = useActiveAccount();
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  useEffect(() => { if (accountId && !selectedAccount) setSelectedAccount(accountId); }, [accountId, selectedAccount]);

  const utils = trpc.useUtils();
  const form = useForm<QuickAddValues>({
    resolver: zodResolver(particularInput),
    defaultValues: defaults(),
  });

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
          accountId: vars.accountId, toAccountId: null,
          accountName: acct?.name ?? "", direction: "OUT", canEditItems: true,
          overrides: [],
        } as never),
      );
      return { prev };
    },
    onError: (error, variables, ctx) => {
      if (ctx) utils.particular.listAll.setData(undefined, ctx.prev);
      toast.error(`Couldn't add "${variables.name}"`, { description: error.message });
    },
    onSettled: () => {
      utils.particular.listAll.invalidate();
      utils.forecast.getData.invalidate();
    },
  });

  // Reset immediately so the next item can be entered without waiting for the
  // server. The mutation fires in the background; the list/forecast refresh
  // when it lands. Concurrent submissions are independent and safe.
  const submit = form.handleSubmit((values) => {
    create.mutate({ accountId: selectedAccount || accountId!, ...values });
    form.reset(defaults());
    form.setFocus("name");
    setSelectedAccount(accountId!);
  });

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-start gap-2 rounded-md border border-dashed p-3"
    >
      <div className="flex-1 min-w-[8rem]">
        <Input placeholder="Name" {...form.register("name")} />
        {form.formState.errors.name && (
          <p className="mt-1 text-xs text-destructive">Name is required</p>
        )}
      </div>
      <Select
        value={form.watch("type")}
        onValueChange={(v) => form.setValue("type", v as "INCOME" | "EXPENSE")}
      >
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="INCOME">Income</SelectItem>
          <SelectItem value="EXPENSE">Expense</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={form.watch("frequency")}
        onValueChange={(v) => form.setValue("frequency", v as Frequency)}
      >
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ONCE_OFF">Once-off</SelectItem>
          <SelectItem value="WEEKLY">Weekly</SelectItem>
          <SelectItem value="FORTNIGHTLY">Fortnightly</SelectItem>
          <SelectItem value="MONTHLY">Monthly</SelectItem>
          <SelectItem value="ANNUAL">Annual</SelectItem>
        </SelectContent>
      </Select>
      <div className="w-28">
        <Input
          type="number"
          step="0.01"
          placeholder="Amount"
          {...form.register("amount", { valueAsNumber: true })}
        />
        {form.formState.errors.amount && (
          <p className="mt-1 text-xs text-destructive">Amount must be positive</p>
        )}
      </div>
      <Input
        type="date"
        className="w-40"
        value={dateToInputValue(form.watch("startDate") as Date | undefined)}
        onChange={(e) => form.setValue("startDate", inputValueToDate(e.target.value), { shouldValidate: true })}
      />
      <Select value={selectedAccount} onValueChange={setSelectedAccount}>
        <SelectTrigger className="w-40"><SelectValue placeholder="Account" /></SelectTrigger>
        <SelectContent>
          {accounts.filter((a) => a.role === "OWNER" || a.canEditItems).map((a) => (
            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={disabled}>Add</Button>
    </form>
  );
}
