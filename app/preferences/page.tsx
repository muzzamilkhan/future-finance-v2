"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Label } from "@/app/_components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/_components/ui/select";
import { usePreferences } from "@/app/_components/PreferencesContext";
import { CURRENCY_OPTIONS, formatCurrency, calendarDateInZone, localeForZone } from "@/lib/preferences";
import { formatUtcWeekdayMonthDay } from "@/lib/dateInput";

const ZONES: string[] = Intl.supportedValuesOf("timeZone");

export default function PreferencesPage() {
  const saved = usePreferences();
  const utils = trpc.useUtils();

  // Pending selection, so the preview reflects what you're about to save.
  const [timeZone, setTimeZone] = useState(saved.timeZone);
  const [currency, setCurrency] = useState(saved.currency);

  // usePreferences() returns DEFAULTS while its query is still loading, so seeding
  // the state above can capture a default that isn't the user's real saved value.
  // Once the real data resolves, sync the pending selection to it exactly once —
  // guarded so it doesn't clobber choices the user has already started making.
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (saved.isLoading || synced) return;
    setTimeZone(saved.timeZone);
    setCurrency(saved.currency);
    setSynced(true);
  }, [saved.isLoading, saved.timeZone, saved.currency, synced]);

  const update = trpc.preferences.update.useMutation({
    onSuccess: (resolved) => {
      // A singleton, not a collection — set the query data directly rather than
      // using the row helpers in lib/optimistic.ts.
      utils.preferences.get.setData(undefined, resolved);
    },
    onError: (error) => {
      setTimeZone(saved.timeZone);
      setCurrency(saved.currency);
      toast.error("Couldn't save preferences", { description: error.message });
    },
  });

  const dirty = timeZone !== saved.timeZone || currency !== saved.currency;
  const previewLocale = localeForZone(timeZone);
  const previewToday = calendarDateInZone(new Date(), timeZone);

  // Options must include the saved value even if it isn't in the curated list, so a
  // manually-set or detected exotic currency is never silently dropped on save.
  const currencyOptions = CURRENCY_OPTIONS.some((o) => o.code === saved.currency)
    ? CURRENCY_OPTIONS
    : [{ code: saved.currency, label: saved.currency }, ...CURRENCY_OPTIONS];

  return (
    <Layout>
      <div className="mx-auto max-w-xl space-y-6 p-4">
        <h1 className="text-2xl font-bold">Preferences</h1>

        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Select value={timeZone} onValueChange={setTimeZone}>
            <SelectTrigger id="timezone"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ZONES.map((z) => <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Decides what counts as “today” in your forecast, and when “skip today” resets.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="currency"><SelectValue /></SelectTrigger>
            <SelectContent>
              {currencyOptions.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Changes how amounts are displayed. It does <strong>not</strong> convert them —
            your existing figures keep their current values.
          </p>
        </div>

        <div className="rounded-md border p-3 text-sm">
          <span className="text-muted-foreground">Preview: </span>
          Balances show as {formatCurrency(1234.56, currency, previewLocale)} ·
          Today is {formatUtcWeekdayMonthDay(previewToday, previewLocale)}
        </div>

        <Button
          disabled={!dirty || update.isPending}
          onClick={() => update.mutate({ timeZone, currency })}
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Layout>
  );
}
