/**
 * Strip currency/grouping characters (e.g. "$1,445.33" -> "1445.33") so a
 * free-text money field parses cleanly. Keeps digits, sign, and the decimal
 * point; everything else ("$", ",", spaces, letters) is removed before Number().
 */
export function parseNumericInput(raw: string): number {
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  return Number(cleaned);
}
