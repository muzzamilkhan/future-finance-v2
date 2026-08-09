"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/_components/ui/select";
import { usePreferences } from "@/app/_components/PreferencesContext";
import { CURRENCY_OPTIONS, formatCurrency, calendarDateInZone, localeForZone } from "@/lib/preferences";
import { formatUtcWeekdayMonthDay } from "@/lib/dateInput";

const ZONES: string[] = Intl.supportedValuesOf("timeZone");

export default function PreferencesPage() {
  const saved = usePreferences();
  const utils = trpc.useUtils();

  // Pending selection, kept as an override of the saved value rather than a copy of
  // it. `null` means "untouched — follow whatever the query currently says". This
  // way the display tracks `saved` (loading defaults, then real data, then a later
  // detect()-driven update, then any refetch) right up until the user actually picks
  // something, and a save can never race a query update: there is no snapshot to go
  // stale, only an override to clear.
  const [pendingTz, setPendingTz] = useState<string | null>(null);
  const [pendingCur, setPendingCur] = useState<string | null>(null);
  const timeZone = pendingTz ?? saved.timeZone;
  const currency = pendingCur ?? saved.currency;

  const update = trpc.preferences.update.useMutation({
    onSuccess: (resolved) => {
      // A singleton, not a collection — set the query data directly rather than
      // using the row helpers in lib/optimistic.ts.
      utils.preferences.get.setData(undefined, resolved);
      setPendingTz(null);
      setPendingCur(null);
    },
    onError: (error) => {
      setPendingTz(null);
      setPendingCur(null);
      toast.error("Couldn't save preferences", { description: error.message });
    },
  });

  const dirty = timeZone !== saved.timeZone || currency !== saved.currency;
  const previewLocale = localeForZone(timeZone);

  // `new Date()` in the render body would be SSR-nondeterministic (this client
  // component is still prerendered on the server) and could hydration-mismatch
  // across a midnight boundary in the selected zone. `useToday()` isn't usable here
  // because it's pinned to the SAVED zone, not the PENDING one the preview must
  // reflect — so mount-guard instead: render a placeholder until the client has
  // mounted, then compute the real "now".
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const previewToday = now ? calendarDateInZone(now, timeZone) : null;

  // Options must include the saved value even if it isn't in the curated list, so a
  // manually-set or detected exotic currency is never silently dropped on save.
  const currencyOptions = CURRENCY_OPTIONS.some((o) => o.code === saved.currency)
    ? CURRENCY_OPTIONS
    : [{ code: saved.currency, label: saved.currency }, ...CURRENCY_OPTIONS];

  // Same fallback for timezone: Intl.supportedValuesOf("timeZone") only lists
  // canonical IANA IDs, so a stored legacy alias (e.g. "Asia/Calcutta", "US/Pacific")
  // wouldn't match any <SelectItem>, leaving the trigger blank and `dirty` false —
  // the user would be stuck unable to even see, let alone repair, their own setting.
  const zoneOptions = ZONES.includes(saved.timeZone) ? ZONES : [saved.timeZone, ...ZONES];

  // Search over the ~420 zones. Matching is case- and separator-insensitive so
  // "new york", "New_York" and "newyork" all find America/New_York.
  const [zoneQuery, setZoneQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const visibleZones = useMemo(() => {
    const q = zoneQuery.trim().toLowerCase().replace(/[\s_/]/g, "");
    if (!q) return zoneOptions;
    // The selected zone always stays in the list: Radix renders the trigger's label
    // from the matching item, so filtering it out would blank the trigger.
    return zoneOptions.filter(
      (z) => z === timeZone || z.toLowerCase().replace(/[\s_/]/g, "").includes(q),
    );
  }, [zoneQuery, zoneOptions, timeZone]);

  return (
    <Layout>
      <div className="mx-auto max-w-xl space-y-6 p-4">
        <h1 className="text-2xl font-bold">Preferences</h1>

        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Select
            value={timeZone}
            onValueChange={setPendingTz}
            onOpenChange={(open) => {
              if (!open) { setZoneQuery(""); return; }
              // Radix focuses the selected item on open; move focus to the search box
              // on the next frame so typing filters instead of driving its typeahead.
              requestAnimationFrame(() => searchRef.current?.focus());
            }}
          >
            <SelectTrigger id="timezone"><SelectValue /></SelectTrigger>
            <SelectContent>
              <div className="sticky top-0 z-10 bg-popover p-1">
                <Input
                  ref={searchRef}
                  value={zoneQuery}
                  onChange={(e) => setZoneQuery(e.target.value)}
                  placeholder="Search timezones…"
                  aria-label="Search timezones"
                  className="h-8"
                  // Radix Select runs its own typeahead and arrow navigation off keydown
                  // at the content level. Without this, letters would jump the list
                  // instead of reaching this field and space would never type. Arrow
                  // keys and Enter still pass through so you can type, then arrow into
                  // the results; Escape still closes.
                  onKeyDown={(e) => {
                    if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(e.key)) {
                      e.stopPropagation();
                    }
                  }}
                />
              </div>
              {visibleZones.length === 0 ? (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                  No timezones match “{zoneQuery}”
                </p>
              ) : (
                visibleZones.map((z) => (
                  <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Decides what counts as “today” in your forecast, and when “skip today” resets.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <Select value={currency} onValueChange={setPendingCur}>
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
          Today is {previewToday ? formatUtcWeekdayMonthDay(previewToday, previewLocale) : "…"}
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
