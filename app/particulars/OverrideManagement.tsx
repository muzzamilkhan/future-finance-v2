"use client";

import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";

export function OverrideManagement({ particularId }: { particularId: string }) {
  const utils = trpc.useUtils();
  const { data: overrides } = trpc.particular.listOverrides.useQuery({ particularId });
  const del = trpc.particular.deleteOverride.useMutation({
    onSuccess: () => { utils.particular.listOverrides.invalidate({ particularId }); utils.forecast.getData.invalidate(); },
  });

  if (!overrides?.length) return <p className="text-sm text-muted-foreground">No overrides.</p>;
  return (
    <div className="space-y-2">
      {overrides.map((o) => (
        <div key={o.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
          <span>
            {format(new Date(o.originalDate), "MMM d, yyyy")}
            {o.isSkipped ? " — skipped"
              : o.overriddenAmount != null ? ` — ${formatCurrency(Number(o.overriddenAmount))}`
              : o.overriddenDate ? ` — moved to ${format(new Date(o.overriddenDate), "MMM d")}` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => del.mutate({ id: o.id })}>Revert</Button>
        </div>
      ))}
    </div>
  );
}
