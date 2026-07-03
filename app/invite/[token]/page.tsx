"use client";
import { use } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/trpc/client";
import { Button } from "@/app/_components/ui/button";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data, error, isLoading } = trpc.invite.get.useQuery({ token }, { retry: false });
  const accept = trpc.invite.accept.useMutation({
    onSuccess: () => {
      utils.account.list.invalidate();
      router.push("/");
    },
  });

  if (isLoading) return <div className="p-8">Loading…</div>;
  if (error) return <div className="p-8">{error.message}</div>;
  return (
    <div className="mx-auto max-w-md p-8 space-y-4">
      <h1 className="text-xl font-bold">{data!.sharedByName} shared an account with you</h1>
      <p><strong>{data!.accountName}</strong></p>
      <ul className="text-sm text-muted-foreground list-disc pl-5">
        {data!.perms.canEditItems && <li>Can edit items</li>}
        {data!.perms.canEditOverrides && <li>Can edit overrides</li>}
        {data!.perms.canUpdateBalance && <li>Can update balance</li>}
        {!data!.perms.canEditItems && !data!.perms.canEditOverrides && !data!.perms.canUpdateBalance && <li>View only</li>}
      </ul>
      <div className="flex gap-2">
        <Button onClick={() => accept.mutate({ token })} disabled={accept.isPending}>Accept</Button>
        <Button variant="outline" onClick={() => router.push("/")}>Decline</Button>
      </div>
    </div>
  );
}
