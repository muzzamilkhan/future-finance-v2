"use client";
import { useRouter } from "next/navigation";
import { useActiveAccount } from "./AccountContext";
import { Button } from "./ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { Badge } from "./ui/badge";
import { ChevronsUpDown, Star, Settings, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export function AccountPicker({ variant = "sidebar" }: { variant?: "sidebar" | "compact" }) {
  const { accounts, setAccountId, activeMembership } = useActiveAccount();
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "compact" ? (
          <button
            type="button"
            className={cn(
              "flex min-w-[5rem] flex-1 flex-col items-center gap-1 py-2 text-xs text-muted-foreground"
            )}
            aria-label="Switch account"
          >
            <Wallet className="h-5 w-5" />
            <span className="max-w-[5rem] truncate">{activeMembership?.name ?? "Account"}</span>
          </button>
        ) : (
          <Button variant="outline" size="sm" className="w-full justify-between">
            <span className="truncate">{activeMembership?.name ?? "Select account"}</span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === "compact" ? "end" : "start"}
        side={variant === "compact" ? "top" : "bottom"}
        className="w-56"
      >
        {accounts.map((a) => (
          <DropdownMenuItem key={a.id} onClick={() => setAccountId(a.id)}>
            <span className="truncate">{a.name}</span>
            {a.isDefault && <Star className="ml-auto h-3 w-3" />}
            {a.role === "MEMBER" && <Badge variant="secondary" className="ml-2">shared</Badge>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/accounts")}>
          <Settings className="mr-2 h-4 w-4" />Manage accounts
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
