# Future Finance v2

A clean rebuild of Future Finance, narrowed to its core: **forecasting future
financial position**. Income/expense rules, daily balance calculations, business-day
adjustments, and per-instance overrides — built from scratch with room to grow.

This repo is **seeded for implementation but not yet implemented.** It contains the
approved design, the task-by-task implementation plan, and the portable UI/theme
baseline carried over from v1.

## What's here

```
docs/superpowers/
  specs/2026-06-28-future-finance-v2-core-forecast-design.md   approved design
  plans/2026-06-28-future-finance-v2-core-forecast.md          implementation plan (16 tasks)
baseline/                                                       portable UI/theme baseline (v1)
  globals.css        OKLCH design tokens (light/dark + finance colors)
  design-system.ts   helper utilities (formatCurrency, color classes, …)
  utils.ts           cn() — clsx + tailwind-merge (ui/* import this)
  components.json     shadcn config
  components/ui/*     shadcn/Radix primitives
```

## How to start implementation

1. Read the spec: `docs/superpowers/specs/2026-06-28-future-finance-v2-core-forecast-design.md`
2. Execute the plan: `docs/superpowers/plans/2026-06-28-future-finance-v2-core-forecast.md`
   - The plan is structured for the `superpowers:subagent-driven-development` or
     `superpowers:executing-plans` skill.
3. The plan scaffolds the app under `app-v2/` in its layout. The `baseline/` theme
   files are the source for the plan's "port the theme" steps (Tasks 12–13) — copy
   them into the client as the plan directs, rather than re-deriving them.

## Stack (per the design)

Vite SPA (React + React Router) · standalone Express API (tRPC + Prisma + Auth.js) ·
PostgreSQL · pure forecast engine shared by both sides · Vitest · Tailwind v4 +
Radix/shadcn UI.

## Scope

**This slice:** single-user forecaster — particulars, recurrence, business-day
adjustment, holidays, instance overrides, anchored daily/monthly forecast, dashboard.

**Deferred (later slices):** multiple accounts, collaboration/share links,
debt-as-account, full UX redesign. See the spec's "Follow-ups" section.
