"use client";

import { useState } from "react";
import { Check, X, Pencil } from "lucide-react";
import { Input } from "@/app/_components/ui/input";
import { useFormatCurrency } from "@/app/_components/PreferencesContext";
import { availableCredit, balanceFromAvailable } from "@/lib/credit";
import type { AccountListItem } from "@/app/_components/AccountContext";

/**
 * Per-account balance lines inside the "Current Balance" card. Each line edits
 * ONE account's balance:
 *  - DEBIT  → the cash balance directly.
 *  - CREDIT → the AVAILABLE credit (stored balance derived: available − limit).
 * The headline combined figure stays read-only on the card above this list.
 */
export function AccountBalanceList(
  { accounts, onSave }:
  { accounts: AccountListItem[]; onSave: (accountId: string, balance: number) => void },
) {
  if (accounts.length <= 1) return null;
  return (
    <div className="mt-3 space-y-1 border-t pt-2">
      {accounts.map((a) => (
        <AccountBalanceRow key={a.id} account={a} onSave={onSave} />
      ))}
    </div>
  );
}

function canEdit(a: AccountListItem): boolean {
  return a.role === "OWNER" || a.canUpdateBalance;
}

function AccountBalanceRow(
  { account, onSave }:
  { account: AccountListItem; onSave: (accountId: string, balance: number) => void },
) {
  const fmt = useFormatCurrency();
  const isCredit = account.type === "CREDIT";
  const limit = account.creditLimit ?? 0;
  // The figure the user sees/edits: cash for debit, available credit for credit.
  const displayValue = isCredit ? availableCredit(account.currentBalance, limit) : account.currentBalance;
  const editable = canEdit(account);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(displayValue));

  const start = () => { setDraft(String(displayValue)); setEditing(true); };
  const save = () => {
    const entered = Number(draft);
    if (Number.isFinite(entered)) {
      onSave(account.id, isCredit ? balanceFromAvailable(entered, limit) : entered);
    }
    setEditing(false);
  };
  const cancel = () => setEditing(false);

  const label = isCredit ? `${account.name} (available)` : account.name;

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
        <Input
          type="number"
          step="0.01"
          autoFocus
          className="h-7 w-28"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
        />
        <button type="button" aria-label="Save" className="text-finance-income hover:opacity-70" onClick={save}>
          <Check className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Cancel" className="text-muted-foreground hover:opacity-70" onClick={cancel}>
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={!editable}
      onClick={editable ? start : undefined}
      className={`flex w-full items-center justify-between gap-2 text-sm ${editable ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
    >
      <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{label}</span>
      <span className={displayValue < 0 ? "text-finance-expense" : "text-foreground"}>
        {fmt(displayValue)}
      </span>
      {editable && <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />}
    </button>
  );
}
