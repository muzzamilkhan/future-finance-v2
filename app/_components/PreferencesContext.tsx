"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/trpc/client";
import {
  formatCurrency, calendarDateInZone, detectFromResolvedOptions,
  DEFAULT_TIME_ZONE, DEFAULT_CURRENCY, DEFAULT_LOCALE,
} from "@/lib/preferences";

type Ctx = {
  timeZone: string; currency: string; locale: string; isLoading: boolean;
};
const PreferencesCtx = createContext<Ctx | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = trpc.preferences.get.useQuery(undefined, { staleTime: 30_000 });
  const utils = trpc.useUtils();
  const detect = trpc.preferences.detect.useMutation({
    onSuccess: (resolved) => { utils.preferences.get.setData(undefined, resolved); },
  });

  // One-shot browser detection for users who have never been detected. The ref
  // guards against a double-invoke under React strict mode; the server's write-once
  // rule is the real protection against races between tabs.
  const attempted = useRef(false);
  useEffect(() => {
    if (isLoading || !data || data.isDetected || attempted.current) return;
    attempted.current = true;
    const opts = Intl.DateTimeFormat().resolvedOptions();
    detect.mutate(detectFromResolvedOptions({ timeZone: opts.timeZone, locale: opts.locale }));
  }, [isLoading, data, detect]);

  const value = useMemo(() => ({
    timeZone: data?.timeZone ?? DEFAULT_TIME_ZONE,
    currency: data?.currency ?? DEFAULT_CURRENCY,
    locale: data?.locale ?? DEFAULT_LOCALE,
    isLoading,
  }), [data, isLoading]);

  return <PreferencesCtx.Provider value={value}>{children}</PreferencesCtx.Provider>;
}

export function usePreferences(): Ctx {
  const c = useContext(PreferencesCtx);
  if (!c) throw new Error("usePreferences must be used within PreferencesProvider");
  return c;
}

/** Money formatter bound to the user's currency and locale. */
export function useFormatCurrency(): (amount: number) => string {
  const { currency, locale } = usePreferences();
  return useCallback((amount: number) => formatCurrency(amount, currency, locale), [currency, locale]);
}

/**
 * UTC midnight of today in the user's zone. Memoised on the resulting timestamp so
 * the identity is stable across renders — it feeds React Query keys and effect
 * dependency arrays, which would otherwise churn on every render.
 */
export function useToday(): Date {
  const { timeZone } = usePreferences();
  const time = calendarDateInZone(new Date(), timeZone).getTime();
  return useMemo(() => new Date(time), [time]);
}
