"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { format } from "date-fns";
import { useActiveAccount } from "@/app/_components/AccountContext";

export default function HolidaysPage() {
  const { accountId } = useActiveAccount();
  const utils = trpc.useUtils();
  const { data: holidays } = trpc.holiday.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId },
  );
  const create = trpc.holiday.create.useMutation({
    onSuccess: () => { utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const del = trpc.holiday.delete.useMutation({
    onSuccess: () => { utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); },
  });
  const [name, setName] = useState(""); const [date, setDate] = useState(""); const [recurring, setRecurring] = useState(false);

  return (
    <Layout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Holidays</h1>
        <form className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); create.mutate({ accountId: accountId!, name, date: new Date(date), isRecurring: recurring }); setName(""); setDate(""); }}>
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="flex items-center gap-1 text-sm">
            <Checkbox checked={recurring} onCheckedChange={(c) => setRecurring(!!c)} /> Recurring
          </label>
          <Button type="submit" size="sm">Add</Button>
        </form>
        <div className="space-y-2">
          {(holidays ?? []).map((h) => (
            <div key={h.id} className="flex justify-between rounded-md border p-3">
              <span>{h.name} — {format(new Date(h.date), "MMM d, yyyy")}{h.isRecurring ? " (yearly)" : ""}</span>
              <Button variant="ghost" size="sm" onClick={() => del.mutate({ accountId: accountId!, id: h.id })}>Delete</Button>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
