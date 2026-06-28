# CLAUDE.md — Future Finance v2

Guidance for Claude Code working in this repo.

## What this repo is

A clean rebuild of Future Finance, narrowed to its core feature: **forecasting future
financial position**. It is **seeded but not yet implemented** — the design and a
task-by-task implementation plan exist; the application code does not yet.

- **Design (read first):** `docs/superpowers/specs/2026-06-28-future-finance-v2-core-forecast-design.md`
- **Implementation plan:** `docs/superpowers/plans/2026-06-28-future-finance-v2-core-forecast.md`
- **UI/theme baseline (v1, portable):** `baseline/`

## How to work here

- To implement, **follow the plan task-by-task** via the `superpowers:executing-plans`
  or `superpowers:subagent-driven-development` skill. Each task is TDD: write the
  failing test, see it fail, implement minimally, see it pass, commit.
- The plan scaffolds the app under `app-v2/`. Use the `baseline/` files as the source
  for the plan's theme-port steps (Tasks 12–13) — copy them in; don't re-derive them.
- Don't expand scope. Multiple accounts, collaboration, debt-as-account, and the full
  UX redesign are **deferred** — see the spec's "Follow-ups". Capture new ideas there
  rather than building them.

## Architecture (per the design)

- **Pure engine** (`lib/engine/`) — no React, no DB, deterministic. "Today" / "skip
  today" are passed in as params, never read from the clock. Imported by both client
  and server. This is the testable heart; cover it exhaustively with Vitest.
- **Server** — standalone Express hosting tRPC + Prisma + Auth.js. The client never
  touches Prisma; all data flows through tRPC.
- **Client** — Vite React SPA (React Router). Runs the engine locally for instant
  recompute. Vite dev-proxies `/api` → the Express server (same-origin auth cookie).

## Key invariants (don't break these)

- `Particular.amount` is stored **positive**; the sign is applied from `type`
  (INCOME +, EXPENSE −) inside the engine.
- The forecast **always replays from the account's `balanceUpdatedAt`** (seeded with
  `currentBalance`) forward to the visible window, then slices for display. Future
  months must reflect every prior event since the last balance update — never a
  floating window start.
- Overrides are matched to instances by `(particularId, originalDate)` with a UTC
  year/month/day compare.
- One `FinanceAccount` per user (`ownerId @unique`), auto-created on first login.
- Override rules: amount override requires `!isFixed`; date/skip requires
  `!isCritical`. Enforced server-side; mirrored client-side.

## Stack

Vite · React 19 · React Router · Vitest · Express · tRPC 11 · Prisma 6 · PostgreSQL ·
Auth.js · Tailwind v4 · Radix/shadcn UI · Zod · React Query · date-fns.

## Conventions

- Test runner is **Vitest** everywhere. No Playwright in this slice.
- Currency: NZD via `Intl.NumberFormat('en-NZ', …)`.
- Keep `lib/engine/` and `lib/schemas/` free of React/Prisma/Express imports.
- Commit frequently — one commit per completed plan task.
