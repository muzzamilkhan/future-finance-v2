# Design: Surfacing per-account exhaustion (overdrawing transfers)

**Date:** 2026-07-01
**Status:** Approved — ready for implementation plan

## Problem

With multi-account consolidation, the dashboard's danger signals are all derived
from the **combined** line (the sum of every account's balance / available credit).
A transfer between two owned accounts is net-zero on that combined line: moving
$1000 from A to B lowers A by $1000 and raises B by $1000, leaving the combined
total unchanged.

This hides a real danger. If Account A holds $500 and transfers $1000 to Account B,
the engine correctly computes A → **−$500** and B → **+$1000**. The combined line
stays flat, so:

- `firstNegative` ("Next Negative") never fires — `combined ≥ 0`.
- `lowest` is unaffected.
- The day card's negative styling (`day.isNegative = combined < 0`) never triggers.

You cannot actually move money an account does not have. That overdraft must
surface — but today it is completely invisible.

### Root cause

Danger detection runs only on the aggregate. The engine *already* computes
per-account `isExhausted` on each `AccountDaily` (debit `balance < 0`, or credit
`availableCredit < 0`), but **no UI code consumes it**. Per-account exhaustion is a
distinct danger from the combined line going negative, and it is currently dropped
on the floor.

## Scope

- Applies to **both** DEBIT and CREDIT accounts. A debit balance below zero and a
  credit account past its limit both count as exhaustion. The engine already treats
  them uniformly via `AccountDaily.isExhausted`.
- The **combined-line** semantics are unchanged. `combined`, `firstNegative`,
  `lowest`, `highest`, and `isNegative` keep their current meaning.
- Non-goals: transfers to external (non-owned) accounts, closed-account handling,
  and any change to how transfers are entered. Out of scope for this slice.

## Design

Three parts: engine signal, dashboard widget, day card marker.

### 1. Engine — first-exhaustion per account

The engine is the single source of truth and must stay exhaustively unit-testable.
Add, without touching combined-line logic:

- **`DailyBalance.hasExhaustedAccount: boolean`** — true if any account in that
  day's closing snapshot has `isExhausted === true`. Derived from the existing
  `accounts` snapshot.
- **`ForecastResult.exhaustions: AccountExhaustion[]`** — one entry per account that
  is exhausted on at least one day in the display window, capturing its *first*
  exhaustion. Shape:

  ```ts
  interface AccountExhaustion {
    accountId: string;
    date: Date;        // first day this account is exhausted
    balance: number;   // that account's balance on that day (negative for debit)
    availableCredit: number | null; // for CREDIT accounts; null for DEBIT
    type: "DEBIT" | "CREDIT";
  }
  ```

  Built by scanning `days` in order and recording the first day each `accountId`
  appears with `isExhausted`. Order the array by `date` ascending (earliest
  exhaustion first) for stable, sensible display.

`firstNegative` and the combined line remain as-is. Exhaustion is additive.

**Testing:** cover in `lib/engine/forecast.test.ts` —
- The canonical case: A=$500 transfers $1000 to B; combined stays ≥ 0 yet
  `exhaustions` contains A with `balance = −500` on the transfer day, and
  `firstNegative` is still null.
- A CREDIT account pushed past its limit appears with the right
  `availableCredit < 0`.
- An account exhausted on multiple days reports only its first.
- No exhaustion anywhere ⇒ empty array, all `hasExhaustedAccount` false.

### 2. Dashboard — "Combined Shortfall" card with per-account lines

Rename the **"Next Negative"** metric to **"Combined Shortfall"** — it reports the
first day the *combined* balance goes negative, which the old label misdescribed.
Its headline value/subtitle behaviour (first-negative amount + date, click scrolls
to that day) is unchanged.

Nest the per-account exhaustion lines **inside** this card, using the same
`footer`-style expandable treatment "Current Balance" already uses for its
`AccountBalanceList`. One line **per exhausted account only** — accounts that never
go exhausted get no line (no line = no problem). Each line shows:

- the account badge/name (reuse `AccountBadge` + `accountNames`/`accountIds`),
- the amount it is overdrawn by at first exhaustion (its `balance`, or
  `availableCredit` for CREDIT, shown in the expense color),
- the date,
- and **on click, scrolls to that day's card** (`scrollToDay(exhaustion.date)`).

If there are no exhaustions the card renders exactly as today (just the combined
figure, no extra lines). The combined `firstNegative` line and the per-account
lines can both be present at once — they are different dangers.

The top-level `DangerNotification` (line 119) stays keyed on `firstNegative` only;
exhaustion surfacing lives in the card for this slice.

### 3. Day card — mark the exhausted account

In `DailyCard`, when `day.hasExhaustedAccount` is true, give the day a visible
marker even if `combined ≥ 0` (so `day.isNegative` is false). Concretely:

- Apply the warning/expense border treatment when either `day.isNegative` **or**
  `day.hasExhaustedAccount`.
- For the account that is exhausted, render its badge in the expense color with its
  negative balance, so opening the day shows exactly which account is overdrawn and
  by how much.

Also include exhaustion days in the daily-card filter on the dashboard
(`app/page.tsx` lines 162–167) so a day whose only notable feature is an exhausted
account is not filtered out.

## Data flow

`computeForecast` (engine) → adds `hasExhaustedAccount` per day and `exhaustions`
to the result → `app/page.tsx` renders the Combined Shortfall card lines and passes
days (now carrying `hasExhaustedAccount`) to `DailyCard` → `DailyCard` marks
exhausted accounts. No server, schema, or tRPC changes — this is entirely engine +
client render, driven by data the engine already had.

## Testing strategy

- **Engine (Vitest, exhaustive):** the cases listed in §1, in
  `lib/engine/forecast.test.ts`.
- **Type-level:** `AccountExhaustion` and the new `DailyBalance` field exported from
  `lib/engine/types.ts`.
- Manual UI verification of the canonical overdraw case on the running dev server.
