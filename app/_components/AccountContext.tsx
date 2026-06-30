"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { trpc } from "@/trpc/client";

export type AccountListItem = {
  id: string; name: string; currentBalance: number; balanceUpdatedAt: Date;
  role: "OWNER" | "MEMBER"; isDefault: boolean;
  canEditItems: boolean; canEditOverrides: boolean; canEditHolidays: boolean; canUpdateBalance: boolean;
};

const STORAGE_KEY = "ff.activeAccountId";

export function pickInitialAccountId(accounts: { id: string; isDefault: boolean }[], stored: string | null): string | null {
  if (stored && accounts.some((a) => a.id === stored)) return stored;
  const def = accounts.find((a) => a.isDefault);
  if (def) return def.id;
  return accounts[0]?.id ?? null;
}

type Ctx = {
  accountId: string | null; setAccountId: (id: string) => void;
  accounts: AccountListItem[]; activeMembership: AccountListItem | null; isLoading: boolean;
};
const AccountCtx = createContext<Ctx | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { data: accounts = [], isLoading } = trpc.account.list.useQuery(undefined, { staleTime: 30_000 });
  const [accountId, setAccountIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!accounts.length) return;
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    setAccountIdState((cur) => pickInitialAccountId(accounts, cur ?? stored));
  }, [accounts]);

  const setAccountId = (id: string) => {
    setAccountIdState(id);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
  };

  const activeMembership = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);

  return (
    <AccountCtx.Provider value={{ accountId, setAccountId, accounts, activeMembership, isLoading }}>
      {children}
    </AccountCtx.Provider>
  );
}

export function useActiveAccount() {
  const c = useContext(AccountCtx);
  if (!c) throw new Error("useActiveAccount must be used within AccountProvider");
  return c;
}
