"use client";

import { createContext, useContext } from "react";
import { trpc } from "@/trpc/client";

type Account = { id: string; name: string; currentBalance: number; balanceUpdatedAt: Date };
const Ctx = createContext<{ account: Account | null; isLoading: boolean }>({ account: null, isLoading: true });

export function ActiveAccountProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = trpc.account.get.useQuery();
  return <Ctx.Provider value={{ account: data ?? null, isLoading }}>{children}</Ctx.Provider>;
}
export const useActiveAccount = () => useContext(Ctx);
