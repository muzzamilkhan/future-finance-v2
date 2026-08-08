import { DEFAULT_TIME_ZONE } from "./defaults";

// Formatters are expensive to construct, and this runs on every render that asks
// for "today". Cache one per zone.
const cache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const hit = cache.get(timeZone);
  if (hit) return hit;
  let fmt: Intl.DateTimeFormat;
  try {
    // en-CA renders as YYYY-MM-DD, which makes the parse below trivial and
    // independent of the caller's locale.
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    // Invalid IANA zone (stale stored value, hand-edited DB row) — don't explode
    // the whole dashboard over a bad string.
    fmt = formatterFor(DEFAULT_TIME_ZONE);
  }
  cache.set(timeZone, fmt);
  return fmt;
}

/**
 * UTC midnight of the calendar date it currently is in `timeZone`.
 *
 * The engine keys every day by its UTC components, so "today" must be expressed as
 * UTC midnight of the user's local calendar date — not as a local-midnight instant,
 * which would land on the wrong UTC day for any non-zero offset. Deliberately avoids
 * date-fns, whose add* / startOfDay helpers work on local wall-clock time and shift
 * UTC-midnight dates across a DST boundary (see CLAUDE.md).
 */
export function calendarDateInZone(now: Date, timeZone: string): Date {
  const parts = formatterFor(timeZone).format(now).split("-").map(Number);
  const [y, m, d] = parts as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}
