"use client";

import { toast } from "sonner";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { toParticularInput } from "@/lib/schemas";
import { CategoryCombobox } from "./CategoryCombobox";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

type Particular = inferRouterOutputs<AppRouter>["particular"]["list"][number];

/**
 * Inline category editor for an expense row — a CategoryCombobox that saves
 * the picked/created category immediately. Category changes are expense-only
 * and feed the budget view, so we invalidate both particular.list and
 * forecast.getData.
 */
export function CategoryPill({ particular }: { particular: Particular }) {
  const { accountId } = useActiveAccount();
  const utils = trpc.useUtils();
  const update = trpc.particular.update.useMutation({
    onSuccess: () => {
      utils.particular.list.invalidate();
      utils.forecast.getData.invalidate();
    },
    onError: (error) => toast.error("Couldn't save category", { description: error.message }),
  });

  const onPick = (next: string) => {
    if (next === (particular.category ?? "")) return; // no change
    update.mutate({ accountId: accountId!, ...toParticularInput(particular), category: next, id: particular.id });
  };

  return (
    <span onClick={(e) => e.stopPropagation()}>
      <CategoryCombobox value={particular.category ?? ""} onChange={onPick} />
    </span>
  );
}
