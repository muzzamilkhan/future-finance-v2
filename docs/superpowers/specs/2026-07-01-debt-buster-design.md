# Debt Buster — Design

**Date:** 2026-07-01
**Status:** Approved design, ready for implementation planning
**Author:** Muzzamil Khan (with Claude)
**Issue:** [#1 — New feature: debt buster](https://github.com/muzzamilkhan/future-finance-v2/issues/1)

## Summary

A standalone section that helps users **visualize their debts** and plan to become
**debt-free faster**. Users add multiple debts (outstanding balance, interest rate,
monthly installment). An analytics view gives a consolidated picture of all debts and
forecasts the debt-free date. A single knob — **extra monthly payment** — lets users
see how paying more changes the forecast. The view compares the **snowball**,
**avalanche**, and a user-defined **custom** payoff order, and derives tips on which
debt to focus on next and how much the extra payment is saving.

The debt payoff math is a deterministic simulation, so it lives in a **pure engine
module** (`lib/engine/debt.ts`) — the same convention as the forecast engine — run on
the client for instant knob response.

## Goals

- Add/edit/delete multiple debts, each with name, outstanding balance, APR, and
  minimum monthly payment.
- A consolidated analytics view: total owed, total minimums, and a debt-free forecast.
- An **extra monthly payment** knob that re-forecasts instantly.
- Compare **snowball**, **avalanche**, and **custom** payoff orders side by side.
- Derive tips: which strategy wins (months + interest saved), which debt to target
  next, and the impact of the current extra payment.

## Non-goals (this slice)

- **No interaction with `FinanceAccount` / credit accounts or the forecast engine.**
  Debt Buster is a parallel, self-contained concept. (The repo already has a `CREDIT`
  account type; debts here are intentionally *separate* from it.)
- **Not shareable / not collaborative.** Debts are tied directly to the `User`, with
  no `AccountMembership` / `ShareInvite` relations — so there is no path to sharing.
- No importing/seeding debts from existing credit accounts.
- No per-debt due-day or "as-of" anchoring date (the simulation is in abstract month
  indices, not calendar dates). Captured as a follow-up.
- No multi-currency handling beyond the app default (NZD via `Intl.NumberFormat`).

## Key decisions

| Decision | Choice |
| --- | --- |
| Relationship to accounts | **Fully standalone** — tied to `User`, separate from `FinanceAccount` |
| Shareable? | **No** — no membership/invite relations, per-user by construction |
| Strategies | **Snowball + Avalanche + Custom** (user-ordered) |
| Where the math lives | **Pure module `lib/engine/debt.ts`**, run client-side |
| Debt fields | **name, balance, APR, minPayment** (the issue's essentials) |
| Forecast timeline | **Abstract month indices** (month 0, 1, 2…), not calendar dates |
| Tips | **Included** — derived from the three-strategy comparison |
| Extra payment | **Single global knob**; rolled into the active strategy's target debt |

## Section 1 — Data model (Prisma)

One new model, related to `User` (not `FinanceAccount`). Being user-owned with no
membership/invite relations is exactly what makes it per-user and unshareable.

```prisma
model Debt {
  id         String   @id @default(cuid())
  userId     String
  name       String
  balance    Decimal  @db.Decimal(15, 2)   // outstanding, stored positive
  apr        Decimal  @db.Decimal(6, 4)    // annual rate as a fraction, e.g. 0.1999
  minPayment Decimal  @db.Decimal(15, 2)   // required monthly installment
  sortOrder  Int      @default(0)          // user's custom payoff priority
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

`User` gains `debts Debt[]`.

- `sortOrder` backs the **Custom** strategy (drag to reorder). Snowball/avalanche
  orderings are *derived at simulation time*, never stored.
- `apr` is stored as a **fraction** (0.1999 = 19.99%); the form converts the
  human-entered percentage on the way in/out.
- No `accountId`, no `AccountMembership`/`ShareInvite` — the absence is the design.

## Section 2 — Pure engine (`lib/engine/debt.ts`)

Deterministic and side-effect-free — **no React, no Prisma, no clock** — exhaustively
covered with Vitest, and run on the client so the extra-payment knob recomputes with
no round-trip (mirrors how the dashboard runs `computeForecast` locally).

### Contract

```ts
// lib/engine/debt.ts — plain types, no Prisma imports
type DebtInput = {
  id: string; name: string;
  balance: number;     // positive
  apr: number;         // annual rate as a fraction (0.1999)
  minPayment: number;  // required monthly installment
};

type Strategy = 'SNOWBALL' | 'AVALANCHE' | 'CUSTOM';

type DebtMonth = {
  month: number;                                   // 0-based index
  perDebt: { id: string; startBalance: number; interest: number;
             payment: number; endBalance: number }[];
  totalBalance: number;
  totalInterest: number;
  totalPaid: number;
};

function simulateDebtPayoff(input: {
  debts: DebtInput[];
  strategy: Strategy;
  extraPayment: number;        // the knob: extra $/month on top of all minimums
  customOrder?: string[];      // debt ids, required when strategy === 'CUSTOM'
  maxMonths?: number;          // safety cap, default 600 (50yr)
}): {
  months: DebtMonth[];
  payoffMonth: number | null;  // months until ALL debts clear; null = not within maxMonths
  totalInterest: number;
  totalPaid: number;
  perDebt: { id: string; payoffMonth: number | null; interestPaid: number }[];
};
```

### The math (per simulated month)

1. **Accrue interest** on each unpaid debt: `interest = balance × (apr / 12)`.
2. **Pay minimums:** each debt pays `min(minPayment, balance + interest)`.
3. **Order** the unpaid debts by strategy:
   - `SNOWBALL` — ascending `balance`
   - `AVALANCHE` — descending `apr`
   - `CUSTOM` — the order in `customOrder`
   Stable tiebreak: `sortOrder`, then `id`.
4. **Apply the surplus** — `extraPayment` **plus the freed-up minimums** of
   already-cleared debts ("rollover") — entirely to the first debt in that order.
   Overflow (surplus larger than the target's remaining balance) cascades to the next
   debt in order within the same month.
5. A debt that reaches zero is cleared; its `minPayment` joins the rollover pool from
   the next month onward.

### Edge cases (handled explicitly and tested)

- **Never-payoff:** if total minimums + extra don't cover total monthly interest, at
  least one balance never falls. Stop at `maxMonths`, return `payoffMonth: null`, and
  set that debt's `perDebt.payoffMonth` to `null`. The UI surfaces "minimum payments
  don't cover interest."
- **0% APR** debts (interest term is 0).
- **Single debt** (no rollover; extra applies directly).
- **`extraPayment: 0`** (pure minimums).
- **Ties** in balance (snowball) or APR (avalanche) — deterministic via the tiebreak.
- **`minPayment` larger than balance** in month 0 — debt clears immediately, surplus
  cascades.

The comparison view calls `simulateDebtPayoff` **three times** (snowball / avalanche /
custom). Diffing those results produces the tips (Section 4).

## Section 3 — Schemas & router

### Zod schemas (`lib/schemas/debt.ts`, re-exported from `lib/schemas/index.ts`)

- `debtInputSchema` — `name` (non-empty, trimmed), `balance` (≥ 0), `apr` (0–1
  fraction), `minPayment` (≥ 0). Shared by the client form and server procedures.
- `simulationParamsSchema` — `strategy` (enum), `extraPayment` (≥ 0),
  `customOrder` (string[] optional). Used client-side to validate knob state; the
  simulation itself is never a server procedure.

Keep `lib/schemas/` free of React/Prisma imports, per repo convention.

### tRPC router (`server/routers/debt.ts`, mounted in `server/routers/_app.ts`)

Every procedure is a `protectedProcedure` scoped to `ctx.session.user.id`. **No
account resolution, no membership checks** — debts belong directly to the user.

```
debt
  list()                 -> Debt[] for the user, ordered by sortOrder
  create(debtInput)      -> appends with sortOrder = max+1
  update({ id, ...debtInput })
  delete({ id })
  reorder({ ids })       -> rewrites sortOrder to match the given id order (Custom)
```

CRUD only. The payoff simulation runs client-side via the pure engine, exactly like
the forecast dashboard runs `computeForecast` in the browser for instant recompute.

## Section 4 — Tips (derived, not stored)

Because the client already runs all three strategies, tips are **pure functions over
`simulateDebtPayoff` outputs** — no new data, no new tables, independently testable:

- **Recommendation:** compare `payoffMonth` / `totalInterest` across snowball vs.
  avalanche → e.g. *"Avalanche clears your debt in 23 months and saves $452 in
  interest vs. snowball."*
- **Next target:** the first debt in the active strategy's order → *"Put your extra
  payments toward Visa next."*
- **Knob impact:** re-run the active strategy with the current vs. zero
  `extraPayment` → *"Your extra $175/mo saves you 8 months and $1,230."*

When a strategy returns `payoffMonth: null`, tips degrade gracefully to the
"minimums don't cover interest — increase your payment" message.

## Section 5 — UI & navigation

### Route

| Route    | Screen |
| -------- | ------ |
| `/debts` | Debt Buster — debt list + add/edit, consolidated analytics, strategy comparison, extra-payment knob, tips |

A **Client Component** that calls `debt.list` via tRPC React Query, maps rows to
`DebtInput`, and runs `simulateDebtPayoff` locally for all three strategies.

### Layout (faithful to existing screens)

- **Debt list** — each debt as a card (name, balance, APR, min payment) with
  edit/delete; an add form using the existing shadcn UI primitives. In Custom mode the
  cards are reorderable (drag), persisted via `debt.reorder`.
- **Consolidated summary** — total owed, total minimum/month, debt-free month/date,
  total interest projected.
- **Strategy toggle** — Snowball / Avalanche / Custom; a small comparison panel shows
  the months + interest for each so the winner is obvious.
- **Extra-payment knob** — a number input / slider feeding `extraPayment`; the
  forecast and tips recompute instantly.
- **Forecast visual** — a simple total-balance-over-months line (recharts, already a
  dependency) showing the declining debt curve down to the debt-free point.
- **Tips panel** — the three derived tips from Section 4.

### Navigation

Add a **Debts** entry to `app/_components/Sidebar.tsx` and `app/_components/BottomNav.tsx`
(e.g. a lucide `Landmark` / `TrendingDown` icon, `to: "/debts"`). The
`AccountPicker` is irrelevant here (debts aren't account-scoped) — the page simply
doesn't depend on the active-account context.

## Section 6 — Testing

- **Engine (priority, exhaustive):** `lib/engine/debt.test.ts` — interest accrual,
  minimum payments, rollover, all three orderings, surplus cascade/overflow, the
  never-payoff cap (`payoffMonth: null`), 0% APR, single debt, `extraPayment: 0`, and
  tie tiebreaks. Assert `totalPaid == totalBalance + totalInterest` as an invariant.
- **Tips:** pure-function tests over crafted simulation outputs (winner selection,
  next-target, knob-impact, graceful degradation when `payoffMonth` is null).
- **Schemas:** `lib/schemas/debt.test.ts` — boundary validation (negative balance,
  apr out of 0–1, empty name).
- **Router:** `server/routers/debt.test.ts` with a mocked Prisma client —
  user-scoping (a user can't read/update another user's debts), `create` sortOrder
  assignment, `reorder` rewrite.
- No Playwright in this slice (consistent with the repo).

## Follow-ups (later spec → plan cycles)

1. **Calendar anchoring** — optional per-debt due-day + balance "as-of" date so the
   debt-free forecast lands on a real date rather than a month index.
2. **Seed-from-credit-account** — a one-time import that pre-fills a debt from an
   existing `CREDIT` account's outstanding balance (convenience only, still no live
   linkage).
3. **Lump-sum / one-off extra payments** at a chosen month, in addition to the
   recurring extra-payment knob.
4. **Variable / promotional APR** windows (e.g. 0% for 12 months, then a revert rate).
5. **Playwright e2e** for the debts flow.
</content>
</invoke>
