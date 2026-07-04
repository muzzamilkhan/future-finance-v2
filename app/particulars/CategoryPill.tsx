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
 * the picked/created category immediately. The particulars page renders from
 * particular.listAll (all accounts), so we optimistically patch and invalidate
 * listAll — not the single-account particular.list, which nothing here reads.
 * Category changes are expense-only and feed the spending view, so we also
 * invalidate forecast.getData.
 */
export function CategoryPill({ particular }: { particular: CategoryPillParticular }) {
  const { defaultAccountId } = useActiveAccount();
  // Rows come from particular.listAll and may belong to a non-default account.
  // Save against the particular's OWN account (mirrors app/spending/page.tsx),
  // otherwise particular.update resolves the default account and 404s the row.
  const accountId = particular.accountId ?? defaultAccountId;
  const utils = trpc.useUtils();
  const update = trpc.particular.update.useMutation({
    onMutate: async (vars) => {
      await utils.particular.listAll.cancel();
      const prev = utils.particular.listAll.getData();
      utils.particular.listAll.setData(undefined, (old) =>
        updateRow(old, vars.id, { category: vars.category ?? null } as never),
      );
      return { prev };
    },
    onError: (error, _vars, ctx) => {
      if (ctx) utils.particular.listAll.setData(undefined, ctx.prev);
      toast.error("Couldn't save category", { description: error.message });
    },
    onSettled: () => {
      utils.particular.listAll.invalidate();
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
