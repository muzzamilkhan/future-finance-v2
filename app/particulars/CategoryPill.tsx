"use client";

import { toast } from "sonner";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { toParticularInput, type StoredParticular } from "@/lib/schemas";
import { CategoryCombobox } from "./CategoryCombobox";
import { updateRow } from "@/lib/optimistic";

/** Minimum shape CategoryPill needs — a superset of StoredParticular with an id. */
type CategoryPillParticular = StoredParticular & { id: string };

/**
 * Inline category editor for an expense row — a CategoryCombobox that saves
 * the picked/created category immediately. Category changes are expense-only
 * and feed the spending view, so we invalidate both particular.list and
 * forecast.getData.
 */
export function CategoryPill({ particular }: { particular: CategoryPillParticular }) {
  const { defaultAccountId: accountId } = useActiveAccount();
  const utils = trpc.useUtils();
  const update = trpc.particular.update.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId };
      await utils.particular.list.cancel(key);
      const prev = utils.particular.list.getData(key);
      utils.particular.list.setData(key, (old) =>
        updateRow(old, vars.id, { category: vars.category ?? null } as never),
      );
      return { prev, key };
    },
    onError: (error, _vars, ctx) => {
      if (ctx) utils.particular.list.setData(ctx.key, ctx.prev);
      toast.error("Couldn't save category", { description: error.message });
    },
    onSettled: () => {
      utils.particular.list.invalidate();
      utils.forecast.getData.invalidate();
    },
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
