import type { AccountListItem } from "@/app/_components/AccountContext";

export function groupAccounts(accounts: AccountListItem[]): {
  owned: AccountListItem[];
  shared: AccountListItem[];
} {
  const owned: AccountListItem[] = [];
  const shared: AccountListItem[] = [];
  for (const a of accounts) {
    if (a.role === "OWNER") owned.push(a);
    else shared.push(a);
  }
  return { owned, shared };
}

export function parseCreditLimit(input: string): number | null {
  const n = Number(input.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a debit balance. Any finite number is allowed (incl. negative/overdrawn); blank means 0. */
export function parseBalance(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Parse a credit account's amount owed. Must be a non-negative finite number; blank means 0. */
export function parseOutstanding(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
