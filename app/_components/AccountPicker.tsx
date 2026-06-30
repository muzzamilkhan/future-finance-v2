"use client";
import { useState } from "react";
import { useActiveAccount } from "./AccountContext";
import { trpc } from "@/trpc/client";
import { Button } from "./ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "./ui/dialog";
import { Badge } from "./ui/badge";
import { ChevronsUpDown, Plus, Star, LogOut, Archive, Share2 } from "lucide-react";
import { SharePanel } from "./SharePanel";

export function AccountPicker() {
  const { accounts, accountId, setAccountId, activeMembership } = useActiveAccount();
  const [sharingOpen, setSharingOpen] = useState(false);
  const utils = trpc.useUtils();
  const invalidate = () => utils.account.list.invalidate();
  const create = trpc.account.create.useMutation({ onSuccess: (r) => { invalidate(); setAccountId(r.id); }, onError: (e) => window.alert(e.message) });
  const setDefault = trpc.account.setDefault.useMutation({ onSuccess: invalidate, onError: (e) => window.alert(e.message) });
  const close = trpc.account.close.useMutation({ onSuccess: invalidate, onError: (e) => window.alert(e.message) });
  const leave = trpc.account.leave.useMutation({ onSuccess: invalidate, onError: (e) => window.alert(e.message) });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between">
            <span className="truncate">{activeMembership?.name ?? "Select account"}</span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          {accounts.map((a) => (
            <DropdownMenuItem key={a.id} onClick={() => setAccountId(a.id)}>
              <span className="truncate">{a.name}</span>
              {a.isDefault && <Star className="ml-auto h-3 w-3" />}
              {a.role === "MEMBER" && <Badge variant="secondary" className="ml-2">shared</Badge>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => {
            const name = window.prompt("New account name", "New Account");
            if (name) create.mutate({ name });
          }}><Plus className="mr-2 h-4 w-4" />New account</DropdownMenuItem>
          {accountId && activeMembership && !activeMembership.isDefault && (
            <DropdownMenuItem onClick={() => setDefault.mutate({ accountId })}>
              <Star className="mr-2 h-4 w-4" />Set as default</DropdownMenuItem>
          )}
          {accountId && activeMembership?.role === "OWNER" && (
            <DropdownMenuItem onClick={() => setSharingOpen(true)}>
              <Share2 className="mr-2 h-4 w-4" />Manage sharing</DropdownMenuItem>
          )}
          {accountId && activeMembership?.role === "OWNER" && (
            <DropdownMenuItem onClick={() => { if (confirm("Close this account?")) close.mutate({ accountId }); }}>
              <Archive className="mr-2 h-4 w-4" />Close account</DropdownMenuItem>
          )}
          {accountId && activeMembership?.role === "MEMBER" && (
            <DropdownMenuItem onClick={() => { if (confirm("Leave this account?")) leave.mutate({ accountId }); }}>
              <LogOut className="mr-2 h-4 w-4" />Leave account</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={sharingOpen} onOpenChange={setSharingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage sharing</DialogTitle>
          </DialogHeader>
          <SharePanel />
        </DialogContent>
      </Dialog>
    </>
  );
}
