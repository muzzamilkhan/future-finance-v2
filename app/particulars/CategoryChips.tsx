"use client";

import { useState } from "react";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { Badge } from "@/app/_components/ui/badge";
import { Input } from "@/app/_components/ui/input";
import { cn } from "@/lib/utils";
import { chipList, commitNewCategory, toggleChip } from "./categorySelection";

/**
 * Quick-pick category selector. Renders each existing category as a toggle
 * chip — clicking selects it, clicking the active one clears to untagged
 * (`""`). A trailing "+ Add" chip reveals an inline field to create a new
 * category. Replaces the native datalist input used in the item form, the
 * inline CategoryPill editor, and the budget retag rows. Selection logic
 * lives in the pure helpers in ./categorySelection (unit-tested there).
 */
export function CategoryChips(
  { value, onChange, disabled = false }:
  { value: string; onChange: (next: string) => void; disabled?: boolean },
) {
  const { accountId } = useActiveAccount();
  const { data: categoryOptions = [] } = trpc.category.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId },
  );

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const chips = chipList(categoryOptions, value);

  const finishAdd = () => {
    const next = commitNewCategory(value, draft);
    if (next !== value) onChange(next);
    setAdding(false);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((name) => {
        const active = name === value;
        return (
          <Badge
            key={name}
            variant={active ? "default" : "secondary"}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-pressed={active}
            className={cn(!disabled && "cursor-pointer", disabled && "opacity-60")}
            onClick={() => !disabled && onChange(toggleChip(value, name))}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChange(toggleChip(value, name));
              }
            }}
          >
            {name}
          </Badge>
        );
      })}

      {!disabled && (adding ? (
        <Input
          autoFocus
          value={draft}
          placeholder="New category"
          className="h-6 w-32 px-2 py-0 text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finishAdd}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); finishAdd(); }
            else if (e.key === "Escape") { e.preventDefault(); setAdding(false); setDraft(""); }
          }}
        />
      ) : (
        <Badge
          variant="outline"
          role="button"
          tabIndex={0}
          className="cursor-pointer text-muted-foreground font-normal"
          onClick={() => setAdding(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAdding(true); }
          }}
        >
          + Add
        </Badge>
      ))}
    </div>
  );
}
