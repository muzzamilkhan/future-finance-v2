import { DEFAULT_CURRENCY } from "./defaults";

// Curated rather than exhaustive. Currency is derived from the browser locale's
// REGION subtag (en-AU -> AU), which needs ~40 entries; deriving it from the IANA
// timezone instead would need a ~400-entry table for no extra accuracy.
const BY_COUNTRY: Record<string, string> = {
  AU: "AUD", NZ: "NZD", US: "USD", CA: "CAD", GB: "GBP", IE: "EUR",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR",
  AT: "EUR", PT: "EUR", FI: "EUR", GR: "EUR", CH: "CHF", NO: "NOK",
  SE: "SEK", DK: "DKK", PL: "PLN", CZ: "CZK", JP: "JPY", CN: "CNY",
  HK: "HKD", SG: "SGD", MY: "MYR", ID: "IDR", TH: "THB", PH: "PHP",
  VN: "VND", IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", AE: "AED",
  SA: "SAR", IL: "ILS", TR: "TRY", ZA: "ZAR", NG: "NGN", KE: "KES",
  EG: "EGP", BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP",
  KR: "KRW", TW: "TWD", FJ: "FJD", PG: "PGK",
};

/** ISO 4217 currency for a 2-letter region code, defaulting when unknown. */
export function currencyForCountry(countryCode: string | undefined): string {
  if (!countryCode) return DEFAULT_CURRENCY;
  return BY_COUNTRY[countryCode.toUpperCase()] ?? DEFAULT_CURRENCY;
}

/** Currencies offered on the preferences page, in rough order of likely use. */
export const CURRENCY_OPTIONS: { code: string; label: string }[] = [
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "NZD", label: "NZD — New Zealand Dollar" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
  { code: "HKD", label: "HKD — Hong Kong Dollar" },
  { code: "JPY", label: "JPY — Japanese Yen" },
  { code: "CNY", label: "CNY — Chinese Yuan" },
  { code: "INR", label: "INR — Indian Rupee" },
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "SEK", label: "SEK — Swedish Krona" },
  { code: "NOK", label: "NOK — Norwegian Krone" },
  { code: "DKK", label: "DKK — Danish Krone" },
  { code: "ZAR", label: "ZAR — South African Rand" },
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "BRL", label: "BRL — Brazilian Real" },
  { code: "MXN", label: "MXN — Mexican Peso" },
  { code: "KRW", label: "KRW — South Korean Won" },
];
