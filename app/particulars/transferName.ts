/**
 * The transfer modal has no name field — a transfer's name is derived from its
 * destination account so the shared `name.min(1)` validation still holds.
 */
export function transferName(toAccountName: string | undefined): string {
  const dest = toAccountName?.trim();
  return dest ? `Transfer to ${dest}` : "Transfer";
}
