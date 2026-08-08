import { DEFAULT_LOCALE } from "./defaults";

// Drives BOTH date wording ("15 Jul" vs "Jul 15") and currency symbol placement, so
// the two always agree. Keyed on the zone's region prefix, with specific-zone
// overrides where a region spans locales.
const BY_ZONE: Record<string, string> = {
  "Pacific/Auckland": "en-NZ",
  "Europe/London": "en-GB",
  "Europe/Dublin": "en-IE",
  "Asia/Singapore": "en-SG",
  "Asia/Hong_Kong": "en-HK",
  "Asia/Tokyo": "ja-JP",
  "Asia/Kolkata": "en-IN",
  "Africa/Johannesburg": "en-ZA",
};

const BY_PREFIX: Record<string, string> = {
  Australia: "en-AU",
  America: "en-US",
  Europe: "en-GB",
  Pacific: "en-AU",
};

/** Display locale for an IANA timezone, defaulting when unknown. */
export function localeForZone(timeZone: string): string {
  if (!timeZone) return DEFAULT_LOCALE;
  const exact = BY_ZONE[timeZone];
  if (exact) return exact;
  const prefix = timeZone.split("/")[0] ?? "";
  return BY_PREFIX[prefix] ?? DEFAULT_LOCALE;
}
