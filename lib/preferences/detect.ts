import { DEFAULT_TIME_ZONE } from "./defaults";
import { currencyForCountry } from "./currencyForCountry";

/**
 * Turn `Intl.DateTimeFormat().resolvedOptions()` into stored preferences.
 * The timezone is already an IANA identifier so it needs no mapping; the currency
 * comes from the locale's region subtag (en-AU -> AU -> AUD).
 */
export function detectFromResolvedOptions(
  opts: { timeZone?: string; locale?: string },
): { timeZone: string; currency: string } {
  // Read the region subtag WITHOUT maximize(): `Intl.Locale("zh-Hans-CN").region`
  // is already "CN", while a bare "en" correctly yields undefined. Calling
  // maximize() would expand "en" to "en-Latn-US" and hand an English-speaking
  // user in an unknown country USD, which is a worse guess than the default.
  let region: string | undefined;
  try {
    region = opts.locale ? new Intl.Locale(opts.locale).region : undefined;
  } catch {
    region = undefined; // malformed locale string
  }
  return {
    timeZone: opts.timeZone || DEFAULT_TIME_ZONE,
    currency: currencyForCountry(region),
  };
}
