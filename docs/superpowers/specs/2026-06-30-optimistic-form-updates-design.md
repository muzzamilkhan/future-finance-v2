# Optimistic (deterministic) form updates

## Problem

Every form in the app mutates through tRPC + React Query using the
wait-for-server pattern: `useMutation({ onSuccess: () => utils.X.invalidate() })`.
The UI only changes after the round-trip completes, so saving a holiday, an
income/expense item, a category change, an override, or a balance edit feels
laggy — the list visibly waits for the network before reflecting the change.

We want these changes to appear immediately (optimistically), with the server
reconciling in the background and rolling back on error.

## Approach

Use React Query's standard optimistic-update lifecycle via `onMutate` /
`onError` / `onSettled` on each list mutation:

1. `onMutate(variables)` — cancel in-flight refetches for the affected query,
   snapshot current cache data, write the optimistic change into the cache,
   return the snapshot as context.
2. `onError(err, variables, ctx)` — restore the snapshot from context, surface
   the error (existing toast/alert behaviour preserved).
3. `onSettled()` — invalidate the affected query (and `forecast.getData`) so the
   server's authoritative data replaces the optimistic guess.

The forecast (`forecast.getData`) is a *computed* query — we do NOT optimistically
patch it (recomputing the engine output client-side is error-prone and out of
scope). It stays on `invalidate` in `onSettled`, so the forecast refreshes a
beat after the form's own list updates instantly. "Show the change" means the
list the user is looking at updates now; the derived forecast catching up
shortly after is acceptable and matches today's behaviour minus the list lag.

### Shared helper

The `onMutate`/`onError`/`onSettled` boilerplate for list-shaped caches is
near-identical across sites. Extract a small helper module
`lib/optimistic.ts` exposing functions that build the mutation callbacks for a
given tRPC util query, keyed by its input. Each call site stays a few lines.

The helper supports three list operations against a `T[]` query cache:

- `optimisticAdd` — prepend/append a temp row (temp id via `crypto.randomUUID()`).
- `optimisticUpdate` — map over rows, replacing the one whose `id` matches.
- `optimisticRemove` — filter out the row whose `id` matches.

Each returns `{ onMutate, onError, onSettled }` wired to the right
`utils.<query>.cancel/getData/setData/invalidate`, plus a caller-supplied list
of extra queries to invalidate on settle (always includes `forecast.getData`
where the original code invalidated it).

Because tRPC's per-procedure utils aren't uniform objects we can pass
generically by reference in a fully type-safe way, the helper takes explicit
`cancel`, `getData`, `setData`, `invalidate` callbacks (thin closures created at
the call site). This keeps each site readable and the helper reusable without
fighting tRPC's generated types.

### Pending visual state

Optimistically-added rows carry a transient marker so a rollback (failed create)
reads as intentional rather than a row vanishing:

- Temp rows get `id` values prefixed `optimistic-` (or a `__optimistic: true`
  flag on the cached object where the row type tolerates an extra field).
- The rendering components apply a subtle pending style to such rows:
  `opacity-60` + `animate-pulse` (Tailwind, already in use elsewhere).
- On `onSettled` invalidation the real row replaces the temp one and the style
  clears automatically.

For updates/deletes the row already exists, so no special pending style is
needed beyond the instant change (delete removes immediately; a failed delete
re-appears on rollback).

## Sites in scope (Tier 1 + Tier 2)

| File | Mutation | Cache patched | Op |
|------|----------|---------------|-----|
| `app/holidays/page.tsx` | `holiday.create` | `holiday.list` | add |
| `app/holidays/page.tsx` | `holiday.delete` | `holiday.list` | remove |
| `app/particulars/QuickAddRow.tsx` | `particular.create` | `particular.list` | add |
| `app/particulars/ParticularForm.tsx` | `particular.create` | `particular.list` | add |
| `app/particulars/ParticularForm.tsx` | `particular.update` | `particular.list` | update |
| `app/particulars/page.tsx` | `particular.delete` | `particular.list` | remove |
| `app/particulars/CategoryPill.tsx` | `particular.update` (category) | `particular.list` | update |
| `app/budget/page.tsx` | `particular.update` (retag) | `particular.list` | update |
| `app/particulars/OverrideManagement.tsx` | `particular.deleteOverride` | `particular.listOverrides` | remove |
| `app/_components/dashboard/OverrideModal.tsx` | `particular.overrideInstance` | `particular.listOverrides` | add/upsert |
| `app/_components/dashboard/OverrideModal.tsx` | `particular.deleteOverride` (revert) | `particular.listOverrides` | remove |
| `app/page.tsx` | `account.updateBalance` | `account.list` | update |

Notes:
- `particular.list` is keyed by `{ accountId }`; `listOverrides` by
  `{ accountId, particularId }`. The optimistic patch must target the exact key.
- `ParticularForm` closes the dialog immediately on submit (optimistic), instead
  of waiting for `onSuccess`. Error rollback re-shows nothing (dialog is closed),
  but the toast still fires and the list row reverts — acceptable; the toast tells
  the user it failed. (If we want the dialog to stay open on error we can revisit,
  but closing-on-submit is the deterministic behaviour the user asked for.)
- `account.updateBalance` input is `{ accountId, balance }`; `account.list`
  returns accounts with a balance field — patch the active account's balance.
- `overrideInstance` is an upsert keyed by `(particularId, originalDate)`: in the
  cache, replace an existing override with the same `originalDate` or add one.
  A temp id is used; `onSettled` reconciles.

## Out of scope (Tier 3 — stays wait-for-server)

`account.create/close/leave/setDefault`, `invite.create`,
`account.removeMember`, `account.updateMemberPerms`, `holiday.import`.
These need server-generated values (invite URL, new account id, import counts),
are rare structural actions where a brief spinner is appropriate, or already
`refetch` snappily. Optimistic treatment adds rollback complexity for little
gain. `SharePanel` member-perm checkboxes already feel responsive via `refetch`;
left as-is.

## Error handling

- Existing error surfaces are preserved exactly: `toast.error(...)` where present,
  `window.alert(...)` in AccountPicker (none of those are in scope anyway).
- Every in-scope site that lacked an `onError` gains one that (a) rolls back via
  the snapshot and (b) shows a toast, so a silent optimistic change can't get
  stuck looking applied when it failed.

## Testing

- Type-check passes (`npm run typecheck`).
- Existing vitest suite still passes (`npm test`) — these are server-router tests,
  unaffected, but run them to confirm no import breakage.
- Manual verification via the running dev server: add a holiday / income item /
  category change / balance edit and confirm the list updates before the network
  settles (throttle network in devtools to make the difference visible), and that
  a forced server error rolls the row back.

## Risks

- Cache key mismatch → optimistic write lands in the wrong/zero queries and the
  UI doesn't update. Mitigated by patching with the exact input object the
  query uses.
- Temp-id rows leaking into code that assumes server ids (e.g. clicking Edit on a
  not-yet-confirmed row). Mitigation: pending rows are styled and `onSettled`
  reconciles within the round-trip; acceptable for this app's single-user-per-
  view usage. Disabling row actions on temp rows is a possible refinement if
  needed but not included by default.
