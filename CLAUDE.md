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
- The plan scaffolds a single **Next.js** app at the repo root. Use the `baseline/`
  files as the source for the plan's theme-port steps — copy them in; don't re-derive.
- Don't expand scope. Multiple accounts, collaboration, debt-as-account, and the full
  UX redesign are **deferred** — see the spec's "Follow-ups". Capture new ideas there
  rather than building them.

## Architecture (per the design)

- **One Next.js (App Router) app** at the repo root serves UI and API from one
  origin — no separate server process, no dev proxy, no CORS.
- **Pure engine** (`lib/engine/`) — no React, no DB, deterministic. "Today" / "skip
  today" are passed in as params, never read from the clock. Imported by both the
  dashboard client component (instant recompute) and the server. This is the testable
  heart; cover it exhaustively with Vitest.
- **Server layer** (`server/`) — tRPC 11 routers + Prisma + NextAuth, mounted via App
  Router route handlers (`app/api/trpc/[trpc]`, `app/api/auth/[...nextauth]`).
  Server-only; client components never touch Prisma — all data flows through tRPC.

## Key invariants (don't break these)

- `Particular.amount` is stored **positive**; the sign is applied from `type`
  (INCOME +, EXPENSE −) inside the engine.
- The forecast **always replays from the account's `balanceUpdatedAt`** (seeded with
  `currentBalance`) forward to the visible window, then slices for display. Future
  months must reflect every prior event since the last balance update — never a
  floating window start.
- Overrides are matched to instances by `(particularId, originalDate)` with a UTC
  year/month/day compare.
- One `FinanceAccount` per user (`ownerId @unique`), auto-created on first
  authenticated request (`resolveAccount`).
- Override rules: amount override requires `!isFixed`; date/skip requires
  `!isCritical`. Enforced server-side; mirrored client-side.

## Stack

Next.js 16 (App Router) · React 19 · Vitest · tRPC 11 · Prisma 7 · PostgreSQL ·
NextAuth v5 (`5.0.0-beta.31`) · Tailwind v4 · Radix/shadcn UI · Zod 4 · React Query 5 ·
date-fns. NextAuth v5 is beta by design (no stable v5 exists).

## Working style (hobby project — keep it simple and quick)

- **Work directly on `main`.** Never create a branch or worktree. This is a hobby
  project; optimize for speed and simplicity.
- **Don't run scripts to verify.** Just make the fix and tell me it's done and live on
  `main`. localhost is usually running, so I'll test manually.
- **Keep tests lean — pure-function tests only.** Cover `lib/engine/` logic; skip
  integration/UI test scaffolding.

## Conventions

- Test runner is **Vitest** everywhere. No Playwright in this slice.
- Currency: NZD via `Intl.NumberFormat('en-NZ', …)`.
- Keep `lib/engine/` and `lib/schemas/` free of React/Prisma/Next imports.
- Commit frequently — one commit per completed plan task.
