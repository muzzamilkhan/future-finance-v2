/**
 * Per-account badge colors. Accounts carry no stored color, so we assign one
 * deterministically from a fixed palette by the account's stable position in
 * the ordered id list (wrapping when there are more accounts than colors).
 * Each entry pairs a light background with readable foreground text, in both
 * light and dark themes.
 */
export const ACCOUNT_COLORS = [
  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
] as const;

/** Fallback for an id not present in the ordered list. */
export const UNKNOWN_ACCOUNT_COLOR =
  "bg-muted text-muted-foreground";

/**
 * Resolve the badge color class for an account, keyed by its index in the
 * stable ordered id list. Unknown ids get the neutral fallback.
 */
export function accountColorClass(accountId: string, orderedIds: string[]): string {
  const idx = orderedIds.indexOf(accountId);
  if (idx < 0) return UNKNOWN_ACCOUNT_COLOR;
  return ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length] ?? UNKNOWN_ACCOUNT_COLOR;
}
