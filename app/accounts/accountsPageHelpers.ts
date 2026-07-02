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
