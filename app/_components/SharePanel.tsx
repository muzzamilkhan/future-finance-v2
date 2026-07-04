"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";
import { useActiveAccount } from "./AccountContext";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";

const PERM_KEYS = ["canEditItems", "canEditOverrides", "canUpdateBalance"] as const;
type PermKey = (typeof PERM_KEYS)[number];
type Perms = Record<PermKey, boolean>;

const permLabel = (k: PermKey) => k.replace("can", "").replace(/([A-Z])/g, " $1").trim();

export function SharePanel({ accountId: accountIdProp }: { accountId?: string } = {}) {
  const { defaultAccountId: activeId } = useActiveAccount();
  const accountId = accountIdProp ?? activeId;
  const [perms, setPerms] = useState<Perms>({
    canEditItems: false,
    canEditOverrides: false,
    canUpdateBalance: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const resetForm = () =>
    setPerms({
      canEditItems: false,
      canEditOverrides: false,
      canUpdateBalance: false,
    });
  const members = trpc.account.members.useQuery(
    { accountId: accountId! },
    { enabled: !!accountId }
  );
  const create = trpc.invite.create.useMutation({
    onSuccess: (r) => {
      const link = `${window.location.origin}${r.url}`;
      setUrl(link);
      navigator.clipboard?.writeText(link).catch(() => {});
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        resetForm();
      }, 1500);
    },
  });
  const remove = trpc.account.removeMember.useMutation({
    onSuccess: () => members.refetch(),
  });
  const updatePerms = trpc.account.updateMemberPerms.useMutation({
    onSuccess: () => members.refetch(),
    onError: (e) => window.alert(e.message),
  });
  const toggle = (k: PermKey) => setPerms((p) => ({ ...p, [k]: !p[k] }));

  const toggleMember = (m: { userId: string } & Perms, k: PermKey) => {
    updatePerms.mutate({
      accountId: accountId!,
      userId: m.userId,
      canEditItems: m.canEditItems,
      canEditOverrides: m.canEditOverrides,
      canUpdateBalance: m.canUpdateBalance,
      [k]: !m[k],
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          {PERM_KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <Checkbox id={k} checked={perms[k]} onCheckedChange={() => toggle(k)} />
              <Label htmlFor={k}>{permLabel(k)}</Label>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <Button
            onClick={() => create.mutate({ accountId: accountId!, ...perms })}
            disabled={create.isPending}
            className={cn(copied && "bg-green-600 text-white hover:bg-green-600")}
          >
            {copied ? "Copied!" : "Create share link"}
          </Button>
          {url && (
            <textarea
              readOnly
              value={url}
              rows={3}
              className="w-full border rounded px-2 py-1 text-sm resize-none break-all"
              onFocus={(e) => e.target.select()}
            />
          )}
        </div>
      </div>
      <div>
        <h3 className="font-medium text-sm mb-1">Members</h3>
        {members.data
          ?.filter((m) => m.role === "MEMBER")
          .map((m) => (
            <div key={m.userId} className="space-y-2 border-t py-2">
              <div className="flex items-center justify-between text-sm">
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
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-1">
                {PERM_KEYS.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <Checkbox
                      id={`${m.userId}-${k}`}
                      checked={m[k]}
                      disabled={updatePerms.isPending}
                      onCheckedChange={() => toggleMember(m, k)}
                    />
                    <Label htmlFor={`${m.userId}-${k}`} className="text-xs font-normal">
                      {permLabel(k)}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
