"use client";
import { createContext, useContext, useMemo } from "react";
import { trpc } from "@/trpc/client";

export type AccountListItem = {
  id: string; name: string; currentBalance: number; balanceUpdatedAt: Date;
  type: "DEBIT" | "CREDIT"; creditLimit: number | null;
  role: "OWNER" | "MEMBER"; isDefault: boolean;
  canEditItems: boolean; canEditOverrides: boolean; canUpdateBalance: boolean;
};

export function pickDefaultAccountId(accounts: { id: string; isDefault: boolean }[]): string | null {
  const def = accounts.find((a) => a.isDefault);
  if (def) return def.id;
  return accounts[0]?.id ?? null;
}

type Ctx = {
  accounts: AccountListItem[]; defaultAccountId: string | null; isLoading: boolean;
};
const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { data: accounts = [], isLoading } = trpc.account.list.useQuery(undefined, { staleTime: 30_000 });
  const defaultAccountId = useMemo(() => pickDefaultAccountId(accounts), [accounts]);

  return (
    <AccountCtx.Provider value={{ accounts, defaultAccountId, isLoading }}>
      {children}
    </AccountCtx.Provider>
  );
}

export function useActiveAccount() {
  const c = useContext(AccountCtx);
  if (!c) throw new Error("useActiveAccount must be used within AccountProvider");
  return c;
}
