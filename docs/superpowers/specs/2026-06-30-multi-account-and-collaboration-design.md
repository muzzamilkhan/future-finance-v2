# Multi-Account & Collaboration — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorm)

## Summary

Add two features to Future Finance v2, built in this order on one shared foundation:

1. **Multi-account per user** — a user can own multiple accounts, switch between them,
   mark one as default (loaded on login), create new accounts, and close (archive) accounts.
2. **Collaboration** — an owner can share an account via a single-use link with
   fine-grained view/edit permissions; a sharee accepts to gain access.

Both rest on a new **`AccountMembership`** join table that replaces the current
one-account-per-user model (`FinanceAccount.ownerId @unique` + `resolveAccount`).

Accounts do **not** interact with each other: overrides, particulars (items), holidays,
and categories remain strictly account-scoped.

## Build order

Multi-account first, collaboration second. Collaboration is then a small delta:
"add another member to the membership table." Each phase is independently shippable.

---

## Section A — Data model

### New: `AccountMembership` (user ↔ account access record)

```
AccountMembership {
  id               String  @id @default(cuid())
  userId           String
  accountId        String
  role             MembershipRole   // OWNER | MEMBER
  isDefault        Boolean @default(false)   // the account loaded on login, per user
  canEditItems     Boolean @default(false)
  canEditOverrides Boolean @default(false)
  canEditHolidays  Boolean @default(false)
  canUpdateBalance Boolean @default(false)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  user             User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  account          FinanceAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  @@unique([userId, accountId])
  @@index([accountId])
}

enum MembershipRole { OWNER | MEMBER }
```

- `OWNER` is treated as all-permissions-true; the boolean flags are authoritative only
  for `MEMBER`. An account has exactly one OWNER membership.
- Exactly one `isDefault: true` per user, enforced in application logic (set-default
  flips the previous default off in a transaction). A closed account cannot be default.

### Changed: `FinanceAccount`

- **Drop** `ownerId @unique` and the `owner` relation.
- **Add** `memberships AccountMembership[]`.
- **Add** `categories String @default("")` (moved off `User`; categories are account-scoped).
- **Add** `closedAt DateTime?` (soft-close / archive).
- Keep `name`, `currentBalance`, `balanceUpdatedAt`, `particulars`, `holidays`, timestamps.

### Changed: `User`

- **Drop** `categories` (moved to `FinanceAccount`).
- **Drop** `financeAccount FinanceAccount?` relation.
- **Add** `memberships AccountMembership[]`.

### New: `ShareInvite` (Phase 2)

```
ShareInvite {
  id               String  @id @default(cuid())
  token            String  @unique
  accountId        String
  createdByUserId  String
  role             MembershipRole @default(MEMBER)
  canEditItems     Boolean @default(false)
  canEditOverrides Boolean @default(false)
  canEditHolidays  Boolean @default(false)
  canUpdateBalance Boolean @default(false)
  acceptedAt       DateTime?   // null = unused; set on accept = consumed (single-use)
  expiresAt        DateTime?   // optional wall-clock expiry, in addition to single-use
  createdAt        DateTime @default(now())
  account          FinanceAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  @@index([accountId])
}
```

### Migration (data-preserving)

For each existing `FinanceAccount`:
1. Create an `OWNER` `AccountMembership` for its current `ownerId`, all four perm flags
   `true`, `isDefault: true`.
2. Copy `User.categories` → `FinanceAccount.categories`.
3. Then drop `FinanceAccount.ownerId` and `User.categories`.

Result: every existing user keeps their account as their default owned account with zero
disruption.

---

## Section B — Server / authorization layer

### Replace `resolveAccount`

`resolveAccount(userId)` (find-or-create by owner) is removed. Replacements:

- `resolveMembership(userId, accountId)` → `{ account, membership }`, throws `FORBIDDEN`
  if no membership, `NOT_FOUND` if the account is closed (for mutations).
- `ensureBootstrapAccount(userId)` → if the user has zero memberships, create a first
  account + OWNER membership marked default. Called lazily (login / first `account.list`).

### `accountProcedure`

A reusable procedure = `protectedProcedure` + `.input(z.object({ accountId: z.string() }))`
+ membership-resolving middleware that puts `ctx.account` and `ctx.membership` in context.
Routers read these instead of calling `resolveAccount`. Keeps each mutation's change small.

### Permission gate

`assertCan(membership, capability)` where capability ∈
`editItems | editOverrides | editHolidays | updateBalance`. Owner short-circuits to
allowed. This is orthogonal to the existing `assertOverrideAllowed` (a *data* rule about
fixed/critical particulars), which stays as-is.

### Router changes

All existing queries/mutations move to `accountProcedure` (gain `accountId` input) and use
`ctx.account` / `ctx.membership`:

- `particular.*` mutations gated by `editItems`.
- `particular` override mutations gated by `editOverrides`.
- `holiday.*` mutations gated by `editHolidays`.
- `account.updateBalance` gated by `updateBalance`.
- `forecast.getData`, `*.list` queries: read access (any membership) — no perm flag needed.
- `category.list` takes `accountId`, reads `FinanceAccount.categories`.

### New `accountRouter` surface

- `list` — user's memberships → joined non-closed accounts with role/perms/isDefault.
- `create({ name })` — new owned account + OWNER membership; first account becomes default.
- `setDefault({ accountId })` — flip default in a transaction.
- `close({ accountId })` — **owner-only** soft-close (`closedAt = now()`); if it was the
  default, reassign default to another of the user's accounts (or none if last).
- `leave({ accountId })` — remove own membership (MEMBER only; OWNER must close instead).
- `members({ accountId })` — owner sees all memberships on the account.
- `updateMemberPerms({ accountId, userId, perms })` — owner-only.
- `removeMember({ accountId, userId })` — owner-only revoke.

### `categorySync` becomes per-account

Writes to `FinanceAccount.categories` (not `User.categories`); keyed by `accountId`.

---

## Section C — Share-invite flow (Phase 2)

### `inviteRouter`

- `create({ accountId, role, perms })` — **owner-only**. Generates a cryptographically
  random token, stores `ShareInvite` with the chosen perms, returns `/invite/<token>` URL.
- `get({ token })` — protected (requires auth). Returns a preview (account name, sharer
  name, perms being granted) **without consuming**. Errors if `acceptedAt` set or expired.
- `accept({ token })` — protected. Re-validates unused + not expired, then in a
  transaction: creates the `AccountMembership` for `ctx.user.id` with the invite's perms
  and sets `acceptedAt: now()`. **Consume point.** Idempotent: if the user already has a
  membership on that account (or it's their own), no-op but still consume.
- Decline is client-side only — it does not consume the invite.

### Link journey — `app/invite/[token]/page.tsx`

1. Sharee opens link. If not signed in → NextAuth (Google) sign-in. The Prisma adapter
   creates the `User` row on sign-in — this is "user set up in DB with no account." We do
   **not** bootstrap a default account on the invite path (avoids creating an empty
   account for someone who declines).
2. After auth → `invite.get` → show "**X** shared **Account Name** with you (can edit
   items, view balance…). Accept?"
3. **Accept** → `invite.accept` → membership created → redirect to dashboard with that
   account active. **Decline** → no membership, link stays unused → redirect to their own
   dashboard (lazily bootstrapping a default account on first dashboard visit).

### Edge cases

Already-used link → friendly "this link has been used." Expired link → friendly message.
Accepting your own / an already-joined account → no-op, still consume.

---

## Section D — Client / UI

### `AccountContext`

React context + `localStorage`. Holds the active `accountId`, exposes `setActiveAccount`.
Initialized from the user's default membership on load. **Single client-side source of
"which account."** Every tRPC call threads `accountId` from this context.

### Account picker (sidebar header)

Dropdown in `Sidebar.tsx`: lists accounts (name, "default" badge, role badge for shared),
**+ New account**, and per-account actions **Set default / Close / Leave / Manage sharing**.
Switching updates `AccountContext` → all queries refetch.

### Members & sharing panel (owner)

List members with their perms; edit perms inline; revoke. **Create share link** button →
copyable URL.

### Permission-aware UI

Edit affordances (add item, override, holiday, update balance) are disabled/hidden per the
active membership's perms — mirroring the server gates, per the CLAUDE.md client-mirror
convention.

### Invite page

`app/invite/[token]/page.tsx` — the accept/decline screen above.

---

## Testing (Vitest)

- Membership resolution + permission gates: owner short-circuit, member allow/deny,
  closed-account `NOT_FOUND`, non-member `FORBIDDEN`.
- Default-account invariant: exactly one default per user; close reassigns default.
- `account` router: create (first = default), setDefault, close (owner-only), leave
  (member-only), member management (owner-only).
- Invite lifecycle: create → get (no consume) → accept (consume) → reuse rejected →
  expired rejected → self/duplicate no-op-but-consume.
- Per-account `categorySync` writes to `FinanceAccount.categories`.
- Migration preserves data (owner membership created, categories copied).
- Engine untouched — already account-agnostic (takes data, not IDs).

## Out of scope (deferred)

- Accounts interacting (cross-account transfers, consolidated views).
- Per-link `canShare` delegation (sharing stays owner-only).
- Negotiated permissions (sharee requesting a level).
- Email delivery of invites (link is copy-paste only).
