# Separate Transfer Add/Edit Form — Design

Date: 2026-07-01

## Goal

Split transfer creation/editing out of the shared `ParticularForm` into a dedicated
transfer modal, lock the to/from accounts when editing a transfer, and add a second
"Add transfer" button next to the existing "Add" button on the Income & Expenses page.

## Motivation

Today a single `ParticularForm` handles INCOME, EXPENSE, and TRANSFER for both add and
update, with `type` as a dropdown. Transfers have a different shape (two accounts, no
name/category) and different edit constraints (accounts must not change on edit). Folding
them into one form makes both the form and its conditional rendering harder to follow.

## Changes

### 1. New `app/particulars/TransferForm.tsx`

A dedicated dialog for transfers with `type` fixed to `"TRANSFER"`.

Fields:
- **From account** — Select (add: editable; edit: read-only/disabled showing the name)
- **To account** — Select (add: editable, excludes the chosen from-account; edit: read-only)
- **Amount**
- **Frequency**
- **Start date**
- **End date (optional)**
- **Business-day adjustment**

No name/category fields. `isCritical`/`isFixed` keep the same defaults as the current form.

Reuses the same `particular.create` / `particular.update` mutations and optimistic-cache
logic (`addRow`/`updateRow`) as `ParticularForm`. On edit, `accountId` and `toAccountId`
are submitted from the existing row unchanged — the accounts are locked in the UI, matching
the existing "account is not editable on update" rule.

### 2. `app/particulars/ParticularForm.tsx`

- Remove `TRANSFER` from the Type dropdown (Income/Expense only).
- Remove the transfer-only From/To account block.
The form is now income/expense only.

### 3. `app/particulars/page.tsx`

- Add a second header button **"Add transfer"** beside **"Add"**, opening `TransferForm`
  in add mode.
- Row **Edit** button routes by type: `p.type === "TRANSFER"` opens `TransferForm`
  (edit mode, accounts locked); otherwise opens `ParticularForm`. Tracked with the existing
  `editing` id plus a small flag selecting which modal is open.

## Invariants respected

- On edit, `accountId`/`toAccountId` are unchanged (locked UI + submitted from `existing`),
  consistent with the "account not editable on update" rule.
- `Particular.amount` stored positive; sign applied by engine from `type`. Unchanged.
- Transfer validation (`toAccountId` required, distinct from `accountId`) already enforced
  in `lib/schemas` and `server/transfers.ts`. Unchanged.

## Testing

The repo has no component/DOM test setup (pure Vitest logic tests only; no Playwright in
this slice). This change is client-form/UI only — no engine or schema changes — so no new
engine tests are warranted. Verify via `tsc` typecheck and the existing Vitest suite.
