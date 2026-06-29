"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/trpc/client";
import { toParticularInput } from "@/lib/schemas";
import { Badge } from "@/app/_components/ui/badge";
import { Input } from "@/app/_components/ui/input";
import { cn } from "@/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

type Particular = inferRouterOutputs<AppRouter>["particular"]["list"][number];

/**
 * Inline category display + editor for an expense row. Idle: a pill showing the
 * category (or a faint "+ Category" prompt). Click to edit via a datalist-backed
 * input; saves on Enter / pick / blur, cancels on Esc, empty clears the category.
 * Category changes are expense-only and feed the budget view, so we invalidate
 * both particular.list and forecast.getData.
 */
export function CategoryPill({ particular }: { particular: Particular }) {
  const utils = trpc.useUtils();
  const { data: categoryOptions = [] } = trpc.category.list.useQuery();
  const update = trpc.particular.update.useMutation({
    onSuccess: () => {
      utils.particular.list.invalidate();
      utils.forecast.getData.invalidate();
    },
    onError: (error) => toast.error("Couldn't save category", { description: error.message }),
  });

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(particular.category ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against blur firing after Enter/Esc already committed/cancelled.
  const committed = useRef(false);

  useEffect(() => {
    if (editing) {
      setValue(particular.category ?? "");
      committed.current = false;
      inputRef.current?.focus();
    }
  }, [editing, particular.category]);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    const next = value.trim();
    if (next === (particular.category ?? "")) return; // no change
    update.mutate({ ...toParticularInput(particular), category: next, id: particular.id });
  };

  const cancel = () => {
    committed.current = true;
    setEditing(false);
    setValue(particular.category ?? "");
  };

  if (editing) {
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          list="category-options"
          value={value}
          placeholder="Category"
          className="h-6 w-32 px-2 py-0 text-xs"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
        />
        <datalist id="category-options">
          {categoryOptions.map((c) => <option key={c} value={c} />)}
        </datalist>
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
