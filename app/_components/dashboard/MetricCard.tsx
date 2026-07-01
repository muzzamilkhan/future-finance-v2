"use client";

import { useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/_components/ui/card";
import { Input } from "@/app/_components/ui/input";
import { formatCurrency } from "@/lib/design-system";

export function MetricCard(
  { title, value, subtitle, type, onClick, editable, onSave, footer }:
  {
    title: string;
    value: number;
    subtitle?: string;
    type: "income" | "expense" | "warning";
    onClick?: () => void;
    editable?: boolean;
    onSave?: (value: number) => void;
    footer?: ReactNode;
  },
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const color = type === "income" ? "text-finance-income" : type === "expense" ? "text-finance-expense" : "text-finance-warning";

  const startEdit = () => { setDraft(String(value)); setEditing(true); };
  const save = () => { onSave?.(Number(draft)); setEditing(false); };
  const cancel = () => setEditing(false);

  const interactive = !editing && (onClick || editable);

  return (
    <Card
      className={interactive ? "cursor-pointer transition-colors hover:bg-accent/50" : undefined}
      onClick={interactive ? (editable ? startEdit : onClick) : undefined}
    >
      <CardHeader className="pb-1 sm:pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent>
        {editing ? (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Input
              type="number"
              step="0.01"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); save(); }
                if (e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
            />
            <button type="button" aria-label="Save" className="text-finance-income hover:opacity-70" onClick={save}>
              <Check className="h-5 w-5" />
            </button>
            <button type="button" aria-label="Cancel" className="text-muted-foreground hover:opacity-70" onClick={cancel}>
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <>
            <div className={`text-xl font-bold sm:text-2xl ${color}`}>{formatCurrency(value)}</div>
            {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          </>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}
