"use client";

import { cn } from "@/lib/utils";

/**
 * Stepped-tab header for the add/edit modals. Purely presentational: the parent
 * owns the active-step state and validation gating; clicking a tab just requests
 * a step change. Rows/columns of the form body live in the parent.
 */
export function FormTabs(
  { tabs, active, onSelect }: { tabs: string[]; active: number; onSelect: (index: number) => void },
) {
  return (
    <div className="flex gap-1 border-b">
      {tabs.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelect(i)}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            i === active
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Two equal columns; pass a single child for a half-width row. */
export function FormRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
