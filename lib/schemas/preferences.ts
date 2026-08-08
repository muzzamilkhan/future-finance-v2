import { z } from "zod";

/** Validate against the runtime's own IANA database rather than a hand-kept list. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const preferencesInput = z.object({
  timeZone: z.string().min(1).refine(isValidTimeZone, "Unknown timezone").optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Must be a 3-letter ISO currency code").optional(),
}).refine(
  (v) => v.timeZone !== undefined || v.currency !== undefined,
  "Provide at least one preference to update",
);

export type PreferencesInput = z.infer<typeof preferencesInput>;
