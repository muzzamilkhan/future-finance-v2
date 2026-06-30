# Credit Accounts & Cross-Account Transfers — Design

**Date:** 2026-06-30
**Status:** Approved, ready for implementation plan

## Summary

Introduce a second account **type** (`CREDIT`) alongside the existing account
(now `DEBIT`), and a new `TRANSFER` particular type that moves money between two
of a user's accounts. The dashboard shows a **single combined "cash available"
forecast line** = debit cash + available credit. The pure engine is extended
from a single-ledger replay to a **per-account replay summed into the combined
line**.

This slice ships **one debit + one credit** per user, but the data model does
not hard-constrain credit count to one — the UI/router enforce the limit so we
can grow to ~3 accounts later (UX choosing which to show) without a schema
change.

## Goals

- Credit account type with an adjustable credit limit, chosen at creation and
  **never convertible**.
- Outstanding owed and available credit derived consistently and folded into the
  combined forecast line.
- A `TRANSFER` particular type with the full income/expense feature set
  (critical/flexible, recurrence, overrides), rendered as `[from] -> [to]`.
- Reassign an existing income/expense particular to another account, clearing its
  overrides.

## Non-goals (this slice)

- More than one credit account (model allows it; UI/router cap at one).
- Converting an account's type after creation.
- Converting an income/expense into a transfer via reassignment.
- Reassigning a `TRANSFER` particular (its FKs are fixed at creation).
- Hard credit-limit enforcement / "card declined" clamping (soft limit only).

## Key decisions

| Decision | Choice |
| --- | --- |
| Dashboard view | Single combined forecast line |
| Combined line meaning | **Cash available** = debit balance + available credit |
| Credit folded in | Per-account running balances tracked, then **summed** per day |
| Transfer shape | **One row, two FKs** (`accountId` = from, `toAccountId` = to) |
| Credit anchor | **Outstanding owed** (stored negative); available = limit + outstanding |
| Limit breach | **Soft limit** — available credit may go negative and is flagged |
| Transfer overrides | **Same gating** as income/expense (amount needs `!isFixed`; date/skip needs `!isCritical`) |
| Reassign scope | **Move only, type unchanged**; `TRANSFER` cannot be reassigned |
| Account count | Start **1 debit + 1 credit**; model permits more, router/UI enforce the cap |

## Section 1 — Account model

`FinanceAccount` gains:

- `type: AccountType` — enum `DEBIT | CREDIT`. Set at creation, never convertible.
- `creditLimit: Decimal?` — `@db.Decimal(15, 2)`, meaningful only for `CREDIT`,
  adjustable later.

Balance semantics:

- **Debit:** `currentBalance` keeps its meaning (cash). `balanceUpdatedAt` is the
  anchor date (unchanged).
- **Credit:** `currentBalance` stores **outstanding owed as a negative number**
  (e.g. `-450.00`). `balanceUpdatedAt` is the anchor date, identical mechanics.
  Available credit is **always derived**:
  `availableCredit = creditLimit + currentBalance` (outstanding is negative, so
  this subtracts what's owed).

Creation / migration:

- The existing auto-created account becomes `DEBIT` (migration sets
  `type = DEBIT`). `resolveAccount` continues to auto-create the debit account.
- A user may add **one credit account** via an explicit "Add credit account"
  action: name, credit limit, current outstanding owed, anchor date. Type is
  locked after creation.
- The DB does **not** constrain credit count to one. The one-credit cap is
  enforced in the router and UI, so growing to ~3 accounts later needs no schema
  change.

## Section 2 — Particular ownership & transfers

`Particular` changes:

- `accountId` stays the **source/owning** account for `INCOME`/`EXPENSE`
  (unchanged). Existing rows migrate to the user's debit account.
- New nullable `toAccountId: String?` — set **only** for `TRANSFER`. For
  transfers, `accountId` = **from**, `toAccountId` = **to**.
- `ParticularType` enum gains `TRANSFER`.

A transfer is **one row, two FKs**: one recurrence, one set of overrides (still
keyed `particularId + originalDate`), one edit point. Amount stays stored
**positive**; the engine applies signs.

Rules (enforced server-side, mirrored client-side):

- `TRANSFER` requires `toAccountId` set and `accountId !== toAccountId`.
- Both accounts must belong to the same owner.
- `INCOME`/`EXPENSE` must have `toAccountId == null`.
- Override gating is **identical** to income/expense: amount override needs
  `!isFixed`; date/skip override needs `!isCritical`.

## Section 3 — Engine (core change)

The engine moves from a single-ledger replay to a **per-account replay summed
into the combined line**. The engine stays pure (no clock, no DB, no React) and
still replays each account from its own anchor forward to the visible window.

`ForecastInput` becomes multi-account:

- `accounts`: array of `{ id, type, anchorBalance, anchorDate, creditLimit }`.
  For credit, `anchorBalance` is the negative outstanding; `creditLimit` is the
  limit.
- Particulars carry `accountId` and, for transfers, `toAccountId`.

Per-day event emission:

- `INCOME` → `+amount` on `accountId`.
- `EXPENSE` → `−amount` on `accountId`.
- `TRANSFER` → `−amount` on `accountId` (from) **and** `+amount` on `toAccountId`
  (to) — same instance, same override, applied atomically that day.

Per-account running balances:

- Each account has its own running balance, replayed from its anchor.
- **Credit:** available credit each day = `creditLimit + runningOutstanding`. May
  go **negative** (soft limit) → flagged like the existing `isNegative`.
- **Debit:** running cash; may go negative (overdraft) → flagged.

Combined **"cash available"** line each day:

`combined = Σ(debit running balances) + Σ(availableCredit per credit account)`

A debit→credit transfer (paying down the card) reduces debit by X and raises
available credit by X → **nets to zero** on the combined line, as intended.

Per-account series remain available so the dashboard can flag a *specific*
account exhausting (debit overdraft or credit over-limit) independently of the
combined line.

Type/shape changes:

- `DailyBalance` / `MonthlySummary` extend to carry **per-account breakdown**
  plus the combined figures.
- `DailyEvent` for a transfer carries the two **account ids** and a direction so
  the client can render `[from] -> [to]`. The engine carries ids only; the client
  maps ids → names (name resolution stays out of the pure engine).

## Section 4 — Server layer

- **`accountRouter`:**
  - `create` — credit only (debit is auto-created); validates the one-credit cap,
    locks type, sets limit + outstanding + anchor.
  - `updateCreditLimit` — adjust a credit account's limit.
  - Balance update extended to set a credit account's **outstanding** (and bump
    `balanceUpdatedAt`).
- **`particularRouter`:**
  - `create` / `update` accept `TRANSFER` with `toAccountId`; validate from≠to,
    same-owner, type/`toAccountId` consistency, and override gating.
  - **`reassignAccount`** (new) — moves an `INCOME`/`EXPENSE` particular to
    another account and **clears all its overrides** in the same transaction.
    Rejects `TRANSFER` particulars. The "overrides will be cleared" warning is
    surfaced client-side before this call.
- **Forecast assembly** — the forecast endpoint gathers all the user's accounts
  and their particulars, builds the multi-account `ForecastInput`, and returns
  combined + per-account results.

## Section 5 — Client / dashboard

- **Add credit account** flow: name, credit limit, current outstanding owed,
  anchor date. Type locked after creation.
- **Account settings:** adjust credit limit; update outstanding (credit) /
  balance (debit).
- **Particular form:** account selector; a **Transfer** type that reveals from/to
  selectors (to ≠ from) and retains critical/flexible, recurrence, and override
  controls.
- **Reassign account** action on income/expense rows → confirm dialog warning
  that overrides will be cleared → optimistic update consistent with the existing
  optimistic-list patterns on this branch.
- **Dashboard:** renders the combined "cash available" line (debit + available
  credit); transfers display as `[from] -> [to]`. Per-account exhaustion
  (overdraft / over-limit) is flagged.

## Section 6 — Testing

- **Engine (Vitest, exhaustive):**
  - Per-account replay from each account's anchor.
  - Transfer emits paired `∓` events on the two accounts for each instance.
  - Debit→credit transfer nets to zero on the combined line.
  - Credit available-credit derivation (`limit + outstanding`) and soft-limit
    negative flagging.
  - Overrides on transfers honour amount/date/skip gating.
  - Replay-from-anchor invariant holds **per account** (future months reflect
    every prior event since each account's last balance update).
- **Schemas:** `TRANSFER` requires `toAccountId`; from≠to; `INCOME`/`EXPENSE`
  forbid `toAccountId`; override gating.
- **Server:** credit creation cap + type lock; `updateCreditLimit`;
  `reassignAccount` clears overrides and rejects transfers; forecast assembly
  across accounts.

## Invariants (extending CLAUDE.md)

- `Particular.amount` stays stored **positive**; sign applied from `type` in the
  engine (`TRANSFER` = − on from, + on to).
- Forecast still **replays from each account's `balanceUpdatedAt`** forward; never
  a floating window start. The per-account invariant now applies to every
  account.
- Overrides still matched by `(particularId, originalDate)` UTC y/m/d compare.
- Credit `currentBalance` is the **outstanding owed, stored negative**;
  `availableCredit = creditLimit + currentBalance` is derived, never stored.
- Account `type` is immutable after creation.
