import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from "./defaults";

const cache = new Map<string, Intl.NumberFormat>();

/**
 * Money formatting. Kept pure and parameterised (rather than reading a module-level
 * "current currency") because this module is shared across requests in the Next.js
 * server process — mutable module state could render one user's currency for another.
 * Components get a bound version via useFormatCurrency().
 */
export function formatCurrency(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const key = `${locale}:${currency}`;
  let fmt = cache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(locale, {
        style: "currency", currency,
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    } catch {
      // Bad stored code — fall back rather than break every balance on the page.
      fmt = new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: "currency", currency: DEFAULT_CURRENCY,
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    }
    cache.set(key, fmt);
  }
  return fmt.format(amount);
}
