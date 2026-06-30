"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { Badge } from "@/app/_components/ui/badge";
import { Input } from "@/app/_components/ui/input";
import { cn } from "@/lib/utils";
import { creatableCategory, filterCategories } from "./categorySelection";

/**
 * Type-to-filter category combo box. Idle: a pill showing the current category
 * (or a faint "+ Category" prompt). Opening reveals a search input over a
 * filtered list of existing categories; typing a name that doesn't exist yet
 * surfaces a "Create …" row. Picking the current category again clears it to
 * untagged (`""`). Replaces the quick-pick CategoryChips in the item form, the
 * inline row editor, and the budget retag rows. Filtering/creation logic lives
 * in the pure helpers in ./categorySelection (unit-tested there).
 *
 * Drop-in for CategoryChips: same `{ value, onChange, disabled? }` contract.
 */
export function CategoryCombobox(
  { value, onChange, disabled = false }:
  { value: string; onChange: (next: string) => void; disabled?: boolean },
) {
  const { accountId } = useActiveAccount();
  const { data: categoryOptions = [] } = trpc.category.list.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId },
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const select = (next: string) => {
    close();
    if (next !== value) onChange(next);
  };

  const matches = filterCategories(categoryOptions, query);
  const creatable = creatableCategory(categoryOptions, query);

  if (!open) {
    return (
      <Badge
        variant="secondary"
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        className={cn(
          !disabled && "cursor-pointer",
          disabled && "opacity-60",
          !value && "text-muted-foreground font-normal",
        )}
        onClick={(e) => { e.stopPropagation(); if (!disabled) setOpen(true); }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); }
        }}
      >
        {value || "+ Category"}
        <span aria-hidden className="opacity-50">▾</span>
      </Badge>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative inline-block"
      onClick={(e) => e.stopPropagation()}
    >
      <Input
        autoFocus
        value={query}
        placeholder="Search or create…"
        className="h-7 w-40 px-2 py-0 text-xs"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); close(); }
          else if (e.key === "Enter") {
            e.preventDefault();
            const first = matches[0];
            if (first !== undefined) select(first);
            else if (creatable) select(creatable);
          }
        }}
      />
      <div className="absolute z-50 mt-1 max-h-56 w-48 overflow-auto rounded-md border bg-popover p-1 shadow-md">
        {value && (
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
            onClick={() => select("")}
          >
            Clear category
          </button>
        )}
        {matches.map((name) => (
          <button
            key={name}
            type="button"
            className={cn(
              "w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
              name === value && "font-medium",
            )}
            onClick={() => select(name)}
          >
            {name}
            {name === value && <span aria-hidden className="ml-1 opacity-50">✓</span>}
          </button>
        ))}
        {creatable && (
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            onClick={() => select(creatable)}
          >
            Create &ldquo;{creatable}&rdquo;
          </button>
        )}
        {matches.length === 0 && !creatable && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No categories</p>
        )}
      </div>
    </div>
  );
}
