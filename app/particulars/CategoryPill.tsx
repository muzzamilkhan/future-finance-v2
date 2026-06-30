"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { toParticularInput } from "@/lib/schemas";
import { Badge } from "@/app/_components/ui/badge";
import { cn } from "@/lib/utils";
import { CategoryChips } from "./CategoryChips";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

type Particular = inferRouterOutputs<AppRouter>["particular"]["list"][number];

/**
 * Inline category display + editor for an expense row. Idle: a pill showing the
 * category (or a faint "+ Category" prompt). Click to expand a quick-pick chip
 * row; picking a chip (or adding/clearing one) saves immediately and collapses.
 * Category changes are expense-only and feed the budget view, so we invalidate
 * both particular.list and forecast.getData.
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

  const [editing, setEditing] = useState(false);

  const onPick = (next: string) => {
    setEditing(false);
    if (next === (particular.category ?? "")) return; // no change
    update.mutate({ accountId: accountId!, ...toParticularInput(particular), category: next, id: particular.id });
  };

  if (editing) {
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <CategoryChips value={particular.category ?? ""} onChange={onPick} />
      </span>
    );
  }

  return (
    <Badge
      variant="secondary"
      role="button"
      tabIndex={0}
      className={cn("cursor-pointer", !particular.category && "text-muted-foreground font-normal")}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); }
      }}
    >
      {particular.category ?? "+ Category"}
      <span aria-hidden className="opacity-50">▾</span>
    </Badge>
  );
}
