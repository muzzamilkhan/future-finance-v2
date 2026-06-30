"use client";

import { trpc } from "@/trpc/client";
import { useActiveAccount } from "@/app/_components/AccountContext";
import { Button } from "@/app/_components/ui/button";
import { formatCurrency } from "@/lib/design-system";
import { format } from "date-fns";
import { removeRow, isTempId } from "@/lib/optimistic";

export function OverrideManagement({ particularId }: { particularId: string }) {
  const { accountId } = useActiveAccount();
  const utils = trpc.useUtils();
  const { data: overrides } = trpc.particular.listOverrides.useQuery(
    { accountId: accountId!, particularId },
    { enabled: !!accountId },
  );
  const del = trpc.particular.deleteOverride.useMutation({
    onMutate: async (vars) => {
      const key = { accountId: vars.accountId, particularId };
      await utils.particular.listOverrides.cancel(key);
      const prev = utils.particular.listOverrides.getData(key);
      utils.particular.listOverrides.setData(key, (old) => removeRow(old, vars.id));
      return { prev, key };
    },
    onError: (_e, _vars, ctx) => { if (ctx) utils.particular.listOverrides.setData(ctx.key, ctx.prev); },
    onSettled: () => { utils.particular.listOverrides.invalidate({ accountId: accountId!, particularId }); utils.forecast.getData.invalidate(); },
  });

  if (!overrides?.length) return <p className="text-sm text-muted-foreground">No overrides.</p>;
  return (
    <div className="space-y-2">
      {overrides.map((o) => (
        <div key={o.id} className={`flex items-center justify-between rounded-md border p-2 text-sm${isTempId(o.id) ? " opacity-60 animate-pulse" : ""}`}>
          <span>
            {format(new Date(o.originalDate), "MMM d, yyyy")}
            {o.isSkipped ? " — skipped"
              : o.overriddenAmount != null ? ` — ${formatCurrency(Number(o.overriddenAmount))}`
              : o.overriddenDate ? ` — moved to ${format(new Date(o.overriddenDate), "MMM d")}` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => del.mutate({ accountId: accountId!, id: o.id })}>Revert</Button>
        </div>
      ))}
    </div>
  );
}
