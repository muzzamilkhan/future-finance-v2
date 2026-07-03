"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Checkbox } from "@/app/_components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/_components/ui/select";
import { Label } from "@/app/_components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/app/_components/ui/dialog";
import { formatUtcMonthDayYear, inputValueToDate } from "@/lib/dateInput";
import { addRow, removeRow, newTempId, isTempId } from "@/lib/optimistic";
import { X } from "lucide-react";

type HolidayItem = { id: string; userId: string; name: string; date: string | Date; isRecurring: boolean; source: string };

function HolidaySection({ title, holidays, canEdit, onDelete }: {
  title: string;
  holidays: HolidayItem[];
  canEdit: boolean;
  onDelete: (h: HolidayItem) => void;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {holidays.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {holidays.map((h) => (
            <div key={h.id} className={`flex items-center justify-between rounded-md border p-3${isTempId(h.id) ? " opacity-60 animate-pulse" : ""}`}>
              <span>
                {h.name} — {formatUtcMonthDayYear(new Date(h.date))}{h.isRecurring ? " (yearly)" : ""}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Delete holiday" disabled={!canEdit} onClick={() => onDelete(h)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HolidaysPage() {
  const canEditHolidays = true;
  const utils = trpc.useUtils();
  const { data: holidays } = trpc.holiday.list.useQuery();
  const create = trpc.holiday.create.useMutation({
    onMutate: async (vars) => {
      const key = undefined;
      await utils.holiday.list.cancel(key);
      const prev = utils.holiday.list.getData(key);
      utils.holiday.list.setData(key, (old) =>
        addRow(old, {
          id: newTempId(),
          userId: "",
          name: vars.name,
          date: vars.date as Date,
          isRecurring: vars.isRecurring ?? false,
          source: "CUSTOM",
        }),
      );
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) utils.holiday.list.setData(ctx.key, ctx.prev);
    },
    onSettled: () => { utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); utils.forecast.getCombined.invalidate(); },
  });
  const del = trpc.holiday.delete.useMutation({
    onMutate: async (vars) => {
      const key = undefined;
      await utils.holiday.list.cancel(key);
      const prev = utils.holiday.list.getData(key);
      utils.holiday.list.setData(key, (old) => removeRow(old, vars.id));
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) utils.holiday.list.setData(ctx.key, ctx.prev);
    },
    onSettled: () => { utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); utils.forecast.getCombined.invalidate(); },
  });
  const [pendingDelete, setPendingDelete] = useState<HolidayItem | null>(null);
  const [name, setName] = useState(""); const [date, setDate] = useState(""); const [recurring, setRecurring] = useState(true);

  const [country, setCountry] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const { data: countries } = trpc.holiday.availableCountries.useQuery();
  const { data: subdivisions } = trpc.holiday.subdivisions.useQuery(
    { countryCode: country },
    { enabled: country.length === 2 },
  );
  const importHolidays = trpc.holiday.import.useMutation({
    onSuccess: (r) => {
      setImportMsg(`Imported ${r.imported} holidays.`);
      utils.holiday.list.invalidate(); utils.forecast.getData.invalidate(); utils.forecast.getCombined.invalidate();
    },
    onError: (e) => setImportMsg(`Import failed: ${e.message}`),
  });

  return (
    <Layout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Holidays</h1>
        <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label>Country</Label>
              <Select value={country || undefined}
                onValueChange={(v) => { setCountry(v); setStateCode(""); }}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {(countries ?? []).map((c) => (
                    <SelectItem key={c.countryCode} value={c.countryCode}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label>State (optional)</Label>
              <Select value={stateCode || undefined} disabled={(subdivisions ?? []).length === 0}
                onValueChange={(v) => setStateCode(v === "__national__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="National only" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__national__">National only</SelectItem>
                  {(subdivisions ?? []).map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-auto flex items-center justify-end gap-2">
            {importMsg && <span className="text-sm text-muted-foreground">{importMsg}</span>}
            <Button size="sm" disabled={!canEditHolidays || country.length !== 2 || importHolidays.isPending}
              onClick={() => { setImportMsg(null); importHolidays.mutate({ countryCode: country, stateCode: stateCode || undefined }); }}>
              {importHolidays.isPending ? "Importing…" : "Import holidays"}
            </Button>
          </div>
        </div>
        <form className="flex flex-col gap-3 rounded-md border p-3"
          onSubmit={(e) => { e.preventDefault(); const parsed = inputValueToDate(date); if (!parsed) return; create.mutate({ name, date: parsed, isRecurring: recurring }); setName(""); setDate(""); setRecurring(true); }}>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label>Name</Label>
              <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="mt-auto flex items-center justify-between gap-2">
            <label className="flex h-9 items-center gap-1 text-sm">
              <Checkbox checked={recurring} onCheckedChange={(c) => setRecurring(!!c)} /> Recurring
            </label>
            <Button type="submit" size="sm" disabled={!canEditHolidays}>Add</Button>
          </div>
        </form>
        </div>
        <HolidaySection title="Imported Holidays"
          holidays={(holidays ?? []).filter((h) => h.source === "IMPORTED")}
          canEdit={canEditHolidays}
          onDelete={setPendingDelete} />
        <HolidaySection title="Custom Holidays"
          holidays={(holidays ?? []).filter((h) => h.source !== "IMPORTED")}
          canEdit={canEditHolidays}
          onDelete={setPendingDelete} />
        <Dialog open={!!pendingDelete} onOpenChange={(o) => { if (!o && !del.isPending) setPendingDelete(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete holiday?</DialogTitle>
              <DialogDescription>
                {pendingDelete
                  ? `"${pendingDelete.name}" will be permanently removed. This cannot be undone.`
                  : null}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={del.isPending} onClick={() => setPendingDelete(null)}>Cancel</Button>
              <Button
                variant="destructive"
                disabled={del.isPending}
                onClick={() => { if (pendingDelete) { del.mutate({ id: pendingDelete.id }); setPendingDelete(null); } }}
              >
                {del.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
