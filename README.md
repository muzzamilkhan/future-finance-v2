# Future Finance v2

Single-user financial forecaster — projects your future account balance from a
manually-maintained current balance using recurring/once-off income and expenses,
holidays, business-day adjustments, and per-instance overrides. Built as one
**Next.js (App Router)** app with a pure, deterministic forecast engine that runs on
both the server and the client.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and set:
   - `DATABASE_URL` — your PostgreSQL connection string
   - `AUTH_SECRET` — `openssl rand -base64 32`
   - `NEXTAUTH_URL` — `http://localhost:3000` in dev
   - your auth provider credentials (see "Auth" below)
3. `npm run db:push` — sync the Prisma schema to your database
4. `npm run dev` — http://localhost:3000

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Next dev server |
| `npm run build` / `npm start` | production build / serve |
| `npm test` | Vitest (engine, schemas, server units) — `npm test -- run` for a single pass |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | push the Prisma schema to the database |
| `npm run db:generate` | regenerate the Prisma client |

## Architecture

```
lib/engine/    pure forecast engine — no React/DB, deterministic; run on server AND in the browser
lib/schemas/   shared Zod schemas (client forms + server procedures)
lib/           toEngine.ts (forecast.getData → engine inputs), design-system helpers, cn()
server/        tRPC routers, Prisma client, NextAuth config, mappers (server-only)
app/           App Router pages + /api/trpc and /api/auth route handlers
  _components/  app shell (Layout/Sidebar/BottomNav), ported shadcn ui/*, dashboard widgets
  page.tsx      Dashboard — runs the engine client-side for instant recompute
  particulars/  holidays/  login/
prisma/        schema + the Prisma config (prisma.config.ts)
baseline/      v1 theme source (already ported into app/)
```

The forecast always **replays from the account's `balanceUpdatedAt`** (seeded with
`currentBalance`) forward to the visible window, then slices for display — so future
months reflect every prior event since the last balance update. `Particular.amount`
is stored positive; the engine applies the sign from `type`.

> **Run the server with `TZ=UTC`.** Date columns are stored as `@db.Date` (UTC
> midnight), and the engine mixes UTC override-matching with local-time day grouping.
> This is consistent under a UTC (or non-negative-offset) runtime. Pin `TZ=UTC` in the
> deploy environment; making the engine uniformly UTC is a tracked follow-up.

## Auth

NextAuth v5 (`next-auth@5.0.0-beta.31`, beta by design — there is no stable v5) with
the Prisma adapter and a **database session strategy**. `server/auth.ts` ships with an
empty `providers: []` — add a real provider (e.g. an OAuth provider, or the email
magic-link provider) and its env vars before sign-in works. On first authenticated
request, a `FinanceAccount` is auto-created for the user.

## Database notes

- The app uses Prisma 7, which requires an explicit **driver adapter** — `db.ts` wires
  `@prisma/adapter-pg` (the `pg` driver). The connection string comes from
  `DATABASE_URL`.
- `prisma.config.ts` loads `.env` for the Prisma CLI.
- If you use a managed Postgres that needs SSL (e.g. Neon), keep `sslmode=require` in
  the URL. Newer `pg` versions warn that `require` will eventually default to
  `verify-full`; if a future `pg` upgrade breaks the connection, switch to
  `uselibpqcompat=true&sslmode=require` or provide a CA cert.

## Testing

`npm test` runs Vitest across `lib/engine` (exhaustive — recurrence, business-day
adjustment, holiday expansion, overrides, and the anchored replay), `lib/schemas`, and
the server units (mappers, override-rule validation, account auto-create). No Playwright
in this slice.

## Scope

**This slice:** single-user forecaster — particulars, recurrence, business-day
adjustment, holidays, instance overrides, anchored daily/monthly forecast, dashboard.

**Deferred (later slices):** multiple accounts, collaboration/share links,
debt-as-account, full UX redesign. See the spec's "Follow-ups" section
(`docs/superpowers/specs/2026-06-28-future-finance-v2-core-forecast-design.md`).
