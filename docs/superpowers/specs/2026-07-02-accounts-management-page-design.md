# Accounts Management Page — Design

**Date:** 2026-07-02
**Status:** Approved

## Problem

Account management is crammed into the `AccountPicker` dropdown (`app/_components/AccountPicker.tsx`),
which does double duty as both the active-account switcher and the management surface. Several
management actions use crude native dialogs (`window.prompt`, `window.confirm`, `window.alert`) that
don't match the app's design philosophy. The dropdown is cluttered with role-gated items.

## Goal

Move account **management** and **creation** onto a dedicated `/accounts` page that follows the same
design philosophy as `/particulars` and `/holidays`. The `AccountPicker` becomes a pure switcher
between existing accounts, plus a link to the new page.

## Design Philosophy (from existing pages)

`/particulars` and `/holidays` establish the pattern the new page must follow:

- `<Layout>` wrapper; `<h1 className="text-2xl font-bold">` title with action buttons top-right.
- Content as **sections** (`<h2>` headings) of **bordered cards/rows** (`rounded-md border p-3`).
- **Inline icon-button actions** per row: `Button variant="ghost" size="icon-sm"` + lucide icon.
- **Radix `Dialog`** for all confirmations and forms — never `window.prompt`/`confirm`/`alert`.
- `canEdit`/role gating derived from `activeMembership`; optimistic tRPC mutations where applicable.

## `/accounts` Page

**File:** `app/accounts/page.tsx` (client component).

**Header:** `<h1>Accounts</h1>` with action buttons top-right:
- **New account** — opens a Dialog with a name input (replaces the current `window.prompt`).
- **Add credit account** — reuses existing `AddCreditAccountDialog`. Shown only when the user has no
  CREDIT account (matches current `!hasCredit` logic).

**Sections:** two `<h2>` groups from `useActiveAccount().accounts`:
- **Your accounts** — `role === "OWNER"`.
- **Shared with you** — `role === "MEMBER"` (omit the section if empty).

**Per-account card** (`rounded-md border p-3`):
- Name, balance via `formatCurrency`, type badge (DEBIT/CREDIT), `default` star, `shared` badge for
  members. For CREDIT accounts, show the credit limit.
- Inline `ghost`/`icon-sm` icon-button actions, role-gated (mirrors current dropdown logic):
  - **Set default** (`Star`) — when not already default → `account.setDefault`.
  - **Edit credit limit** (`Wallet`) — CREDIT + OWNER → Dialog with a numeric input →
    `account.updateCreditLimit` (replaces `window.prompt`; validates finite > 0).
  - **Manage sharing** (`Share2`) — OWNER → Dialog wrapping the existing `SharePanel`.
  - **Close** (`Archive`) — OWNER → confirmation Dialog → `account.close` (replaces `window.confirm`).
  - **Leave** (`LogOut`) — MEMBER → confirmation Dialog → `account.leave`.

**Mutation behaviour:** on `account.list`-affecting mutations, invalidate `account.list` (and
`forecast.getCombined` where the current code does). Creating an account switches to it via
`setAccountId`. Errors surface via the same tRPC error handling (kept out of native `alert`).

## AccountPicker changes

`AccountPicker` becomes a **pure switcher**:
- Keep: the account list with switch-on-click, `default` star, `shared` badge, both `sidebar` and
  `compact` variants.
- Keep: a **"Manage accounts"** dropdown item linking to `/accounts` (via `next/link` or router push).
- Remove: New account, Add credit account, Edit credit limit, Set default, Manage sharing, Close,
  Leave — and the `Dialog`/`SharePanel`/`AddCreditAccountDialog`/`window.*` code that supported them.

## Navigation

Add an **Accounts** entry (`Wallet` icon, `to: "/accounts"`) to the nav arrays in both
`app/_components/Sidebar.tsx` and `app/_components/BottomNav.tsx`.

## Reuse (no changes)

`SharePanel`, `AddCreditAccountDialog`, all `account.*` tRPC mutations, `useActiveAccount`. No
server/engine/schema changes.

## Out of scope

No new tRPC procedures, no schema changes, no changes to sharing/invite mechanics beyond relocating
the existing `SharePanel` into the page's sharing Dialog.
