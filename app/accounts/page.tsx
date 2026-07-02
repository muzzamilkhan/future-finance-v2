"use client";

import { useState } from "react";
import { useActiveAccount, type AccountListItem } from "@/app/_components/AccountContext";
import { trpc } from "@/trpc/client";
import { Layout } from "@/app/_components/Layout";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Label } from "@/app/_components/ui/label";
import { Badge } from "@/app/_components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/app/_components/ui/dialog";
import { formatCurrency } from "@/lib/design-system";
import { SharePanel } from "@/app/_components/SharePanel";
import { AddCreditAccountDialog } from "@/app/_components/account/AddCreditAccountDialog";
import { Star, Wallet, Share2, Archive, LogOut } from "lucide-react";
import { groupAccounts, parseCreditLimit } from "./accountsPageHelpers";

export default function AccountsPage() {
  const { accounts, accountId, setAccountId } = useActiveAccount();
  const utils = trpc.useUtils();
  const invalidate = () => utils.account.list.invalidate();

  const create = trpc.account.create.useMutation({ onSuccess: (r) => { invalidate(); setAccountId(r.id); }, onError: (e) => setError(e.message) });
  const setDefault = trpc.account.setDefault.useMutation({ onSuccess: invalidate, onError: (e) => setError(e.message) });
  const close = trpc.account.close.useMutation({ onSuccess: invalidate, onError: (e) => setError(e.message) });
  const leave = trpc.account.leave.useMutation({ onSuccess: invalidate, onError: (e) => setError(e.message) });
  const updateCreditLimit = trpc.account.updateCreditLimit.useMutation({
    onSuccess: () => { invalidate(); utils.forecast.getCombined.invalidate(); },
    onError: (e) => setError(e.message),
  });

  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("New Account");
  const [addCreditOpen, setAddCreditOpen] = useState(false);
  const [sharing, setSharing] = useState<AccountListItem | null>(null);
  const [limitFor, setLimitFor] = useState<AccountListItem | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [closing, setClosing] = useState<AccountListItem | null>(null);
  const [leaving, setLeaving] = useState<AccountListItem | null>(null);

  const { owned, shared } = groupAccounts(accounts);
  const hasCredit = accounts.some((a) => a.type === "CREDIT");

  const renderCard = (a: AccountListItem) => (
    <div key={a.id} className="rounded-md border p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{a.name}</span>
          {a.isDefault && <Star className="h-3 w-3" aria-label="Default" />}
          <Badge variant="secondary">{a.type === "CREDIT" ? "Credit" : "Debit"}</Badge>
          {a.role === "MEMBER" && <Badge variant="secondary">shared</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {formatCurrency(a.currentBalance)}
            {a.type === "CREDIT" && a.creditLimit != null ? ` / ${formatCurrency(a.creditLimit)}` : ""}
          </span>
          {!a.isDefault && (
            <Button variant="ghost" size="icon-sm" aria-label="Set as default"
              onClick={() => setDefault.mutate({ accountId: a.id })}>
              <Star className="size-4" />
            </Button>
          )}
          {a.type === "CREDIT" && a.role === "OWNER" && (
            <Button variant="ghost" size="icon-sm" aria-label="Edit credit limit"
              onClick={() => { setLimitInput(String(a.creditLimit ?? "")); setLimitFor(a); }}>
              <Wallet className="size-4" />
            </Button>
          )}
          {a.role === "OWNER" && (
            <Button variant="ghost" size="icon-sm" aria-label="Manage sharing"
              onClick={() => setSharing(a)}>
              <Share2 className="size-4" />
            </Button>
          )}
          {a.role === "OWNER" && (
            <Button variant="ghost" size="icon-sm" aria-label="Close account"
              onClick={() => setClosing(a)}>
              <Archive className="size-4" />
            </Button>
          )}
          {a.role === "MEMBER" && (
            <Button variant="ghost" size="icon-sm" aria-label="Leave account"
              onClick={() => setLeaving(a)}>
              <LogOut className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Accounts</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => { setNewName("New Account"); setNewOpen(true); }}>New account</Button>
            {!hasCredit && (
              <Button size="sm" variant="outline" onClick={() => setAddCreditOpen(true)}>Add credit account</Button>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Your accounts</h2>
          {owned.length === 0 ? <p className="text-muted-foreground">No accounts yet.</p> : owned.map(renderCard)}
        </section>

        {shared.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">Shared with you</h2>
            {shared.map(renderCard)}
          </section>
        )}

        {/* New account */}
        <Dialog open={newOpen} onOpenChange={(o) => { if (!o && !create.isPending) setNewOpen(false); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>New account</DialogTitle></DialogHeader>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={create.isPending} onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button disabled={create.isPending || !newName.trim()}
                onClick={() => { setError(null); create.mutate({ name: newName.trim() }); setNewOpen(false); }}>
                {create.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit credit limit */}
        <Dialog open={!!limitFor} onOpenChange={(o) => { if (!o && !updateCreditLimit.isPending) setLimitFor(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit credit limit</DialogTitle></DialogHeader>
            <div className="space-y-1">
              <Label>Credit limit</Label>
              <Input value={limitInput} onChange={(e) => setLimitInput(e.target.value)} inputMode="decimal" />
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={updateCreditLimit.isPending} onClick={() => setLimitFor(null)}>Cancel</Button>
              <Button disabled={updateCreditLimit.isPending || parseCreditLimit(limitInput) === null}
                onClick={() => {
                  const n = parseCreditLimit(limitInput);
                  if (limitFor && n !== null) { setError(null); updateCreditLimit.mutate({ accountId: limitFor.id, creditLimit: n }); setLimitFor(null); }
                }}>
                {updateCreditLimit.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Manage sharing */}
        <Dialog open={!!sharing} onOpenChange={(o) => { if (!o) setSharing(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Manage sharing</DialogTitle></DialogHeader>
            {sharing && <SharePanel accountId={sharing.id} />}
          </DialogContent>
        </Dialog>

        {/* Close */}
        <Dialog open={!!closing} onOpenChange={(o) => { if (!o && !close.isPending) setClosing(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Close account?</DialogTitle>
              <DialogDescription>{closing ? `"${closing.name}" will be closed.` : null}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={close.isPending} onClick={() => setClosing(null)}>Cancel</Button>
              <Button variant="destructive" disabled={close.isPending}
                onClick={() => { if (closing) { setError(null); close.mutate({ accountId: closing.id }); setClosing(null); } }}>
                {close.isPending ? "Closing..." : "Close account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Leave */}
        <Dialog open={!!leaving} onOpenChange={(o) => { if (!o && !leave.isPending) setLeaving(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Leave account?</DialogTitle>
              <DialogDescription>{leaving ? `You will lose access to "${leaving.name}".` : null}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" disabled={leave.isPending} onClick={() => setLeaving(null)}>Cancel</Button>
              <Button variant="destructive" disabled={leave.isPending}
                onClick={() => { if (leaving) { setError(null); leave.mutate({ accountId: leaving.id }); setLeaving(null); } }}>
                {leave.isPending ? "Leaving..." : "Leave account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AddCreditAccountDialog isOpen={addCreditOpen} onClose={() => setAddCreditOpen(false)} onCreated={(id) => setAccountId(id)} />
      </div>
    </Layout>
  );
}
