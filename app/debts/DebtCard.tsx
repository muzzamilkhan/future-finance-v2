"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Card } from "@/app/_components/ui/card";
import { useFormatCurrency } from "@/app/_components/PreferencesContext";

export function DebtCard({
  debt,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  debt: { id: string; name: string; balance: number; apr: number; minPayment: number };
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const fmt = useFormatCurrency();
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className="flex w-full cursor-pointer flex-row items-center gap-3 p-4 text-left transition-colors hover:bg-accent/50 focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
    >
      <div className="w-full min-w-0 flex-1">
        <p className="font-medium">{debt.name}</p>
        <p className="text-sm text-muted-foreground">
          {fmt(debt.balance)} · {(debt.apr * 100).toFixed(2)}% · {fmt(debt.minPayment)}/mo
        </p>
      </div>
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          aria-label={`Move ${debt.name} up`}
          disabled={!canMoveUp}
          onClick={(e) => {
            e.stopPropagation();
            onMoveUp();
          }}
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label={`Move ${debt.name} down`}
          disabled={!canMoveDown}
          onClick={(e) => {
            e.stopPropagation();
            onMoveDown();
          }}
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        aria-label={`Delete ${debt.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
      >
        <X className="h-4 w-4" />
      </button>
    </Card>
  );
}
