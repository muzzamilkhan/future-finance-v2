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
  const { accountId, activeMembership } = useActiveAccount();
  const canEditHolidays = !activeMembership || activeMembership.role === "OWNER" || activeMembership.canEditHolidays;
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

  const [country, setCountry] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const { data: countries } = trpc.holiday.availableCountries.useQuery(
    { accountId: accountId! }, { enabled: !!accountId },
  );
  const { data: subdivisions } = trpc.holiday.subdivisions.useQuery(
    { accountId: accountId!, countryCode: country },
    { enabled: !!accountId && country.length === 2 },
  );
  const importHolidays = trpc.holiday.import.useMutation({
    onSuccess: (r) => {
      setImportMsg(`Imported ${r.imported}, updated ${r.updated}.`);
      utils.holiday.list.invalidate(); utils.forecast.getData.invalidate();
    },
    onError: (e) => setImportMsg(`Import failed: ${e.message}`),
  });

  return (
    <Layout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Holidays</h1>
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1 text-sm">
            <span>Country</span>
            <select className="rounded-md border px-2 py-1" value={country}
              onChange={(e) => { setCountry(e.target.value); setStateCode(""); }}>
              <option value="">Select…</option>
              {(countries ?? []).map((c) => (
                <option key={c.countryCode} value={c.countryCode}>{c.name}</option>
              ))}
            </select>
          </div>
          {(subdivisions ?? []).length > 0 && (
            <div className="flex flex-col gap-1 text-sm">
              <span>State (optional)</span>
              <select className="rounded-md border px-2 py-1" value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}>
                <option value="">National only</option>
                {(subdivisions ?? []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <Button size="sm" disabled={!canEditHolidays || country.length !== 2 || importHolidays.isPending}
            onClick={() => { setImportMsg(null); importHolidays.mutate({ accountId: accountId!, countryCode: country, stateCode: stateCode || undefined }); }}>
            {importHolidays.isPending ? "Importing…" : "Import holidays"}
          </Button>
          {importMsg && <span className="text-sm text-muted-foreground">{importMsg}</span>}
        </div>
        <form className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); create.mutate({ accountId: accountId!, name, date: new Date(date), isRecurring: recurring }); setName(""); setDate(""); }}>
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="flex items-center gap-1 text-sm">
            <Checkbox checked={recurring} onCheckedChange={(c) => setRecurring(!!c)} /> Recurring
          </label>
          <Button type="submit" size="sm" disabled={!canEditHolidays}>Add</Button>
        </form>
        <div className="space-y-2">
          {(holidays ?? []).map((h) => (
            <div key={h.id} className="flex justify-between rounded-md border p-3">
              <span>
                {h.name} — {format(new Date(h.date), "MMM d, yyyy")}{h.isRecurring ? " (yearly)" : ""}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {h.source === "IMPORTED" ? "Imported" : "Custom"}
                </span>
              </span>
              <Button variant="ghost" size="sm" disabled={!canEditHolidays} onClick={() => del.mutate({ accountId: accountId!, id: h.id })}>Delete</Button>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
