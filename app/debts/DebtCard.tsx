"use client";

import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { formatCurrency } from "@/lib/design-system";

export function DebtCard({
  debt,
  onEdit,
  onDelete,
}: {
  debt: { id: string; name: string; balance: number; apr: number; minPayment: number };
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div>
        <p className="font-medium">{debt.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatCurrency(debt.balance)} · {(debt.apr * 100).toFixed(2)}% · {formatCurrency(debt.minPayment)}/mo
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete}>Delete</Button>
      </div>
    </Card>
  );
}
