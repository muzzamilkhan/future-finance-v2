import { DEFAULT_CURRENCY, DEFAULT_TIME_ZONE } from "./defaults";
import { localeForZone } from "./localeForZone";

export type StoredPreferences = { timeZone: string | null; currency: string | null };
export type ResolvedPreferences = {
  timeZone: string; currency: string; locale: string; isDetected: boolean;
};

/**
 * Apply defaults to the stored row. `isDetected` is false unless BOTH columns are
 * set — that's what tells the client to run one-time browser detection. A partially
 * filled row is treated as undetected so the missing half still gets filled in.
 */
export function resolvePreferences(row: StoredPreferences): ResolvedPreferences {
  const timeZone = row.timeZone ?? DEFAULT_TIME_ZONE;
  return {
    timeZone,
    currency: row.currency ?? DEFAULT_CURRENCY,
    locale: localeForZone(timeZone),
    isDetected: row.timeZone !== null && row.currency !== null,
  };
}
