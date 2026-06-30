"use client";
import { useState } from "react";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "./AccountContext";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";

export function SharePanel() {
  const { accountId } = useActiveAccount();
  const [perms, setPerms] = useState({
    canEditItems: false,
    canEditOverrides: false,
    canEditHolidays: false,
    canUpdateBalance: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  const members = trpc.account.members.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );
  const create = trpc.invite.create.useMutation({
    onSuccess: (r) => setUrl(`${window.location.origin}${r.url}`),
  });
  const remove = trpc.account.removeMember.useMutation({
    onSuccess: () => members.refetch(),
  });
  const toggle = (k: keyof typeof perms) => setPerms((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {(["canEditItems", "canEditOverrides", "canEditHolidays", "canUpdateBalance"] as const).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <Checkbox id={k} checked={perms[k]} onCheckedChange={() => toggle(k)} />
            <Label htmlFor={k}>{k.replace("can", "").replace(/([A-Z])/g, " $1").trim()}</Label>
          </div>
        ))}
        <Button
          onClick={() => create.mutate({ accountId: accountId!, ...perms })}
          disabled={create.isPending}
        >
          Create share link
        </Button>
        {url && (
          <input
            readOnly
            value={url}
            className="w-full border rounded px-2 py-1 text-sm"
            onFocus={(e) => e.target.select()}
          />
        )}
      </div>
      <div>
        <h3 className="font-medium text-sm mb-1">Members</h3>
        {members.data
          ?.filter((m) => m.role === "MEMBER")
          .map((m) => (
            <div key={m.userId} className="flex items-center justify-between text-sm py-1">
              <span>{m.name ?? m.email}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => remove.mutate({ accountId: accountId!, userId: m.userId })}
                disabled={remove.isPending}
              >
                Remove
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}
