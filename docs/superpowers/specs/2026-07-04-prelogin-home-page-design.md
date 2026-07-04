# Pre-login Home Page (Design)

**Date:** 2026-07-04
**Status:** Approved design, ready for implementation planning
**Author:** Muzzamil Khan (with Claude)

## Purpose

The app has no proper marketing/landing page. A logged-out visitor to `/` currently
gets the authenticated dashboard shell with failing tRPC calls. This spec adds a
single-page marketing home page that explains what Future Finance is and what it helps
you do, with a Sign in button at the top.

## Behaviour

- **Logged-out visitor at `/`** → the new marketing home page.
- **Logged-in user at `/`** → the dashboard, exactly as today (no redirect flash).

The dashboard stays at `/`. Only the logged-out experience changes.

## Architecture

Today `app/page.tsx` is a `"use client"` dashboard. We split auth-gating to the server:

1. **`app/page.tsx`** becomes a small **server component**. It calls `auth()`:
   - session present → render `<DashboardPage />`
   - no session → render `<HomePage />`
2. **`app/_components/DashboardPage.tsx`** — the existing client dashboard body, moved
   verbatim from the current `app/page.tsx` (still `"use client"`), imported by the
   server `page.tsx`. No behavioural change to the dashboard.
3. **`app/_components/home/HomePage.tsx`** — the new marketing page. A **server
   component**; the Sign in control is a plain `<a>` to
   `/api/auth/signin?callbackUrl=/`, matching the existing `/login` page. No client
   JS required.

No middleware, no redirects. `auth()` is already used server-side (`server/trpc.ts`,
`server/auth.ts` exports `auth`), so this reuses the existing pattern.

## Home page content & layout

One scrollable page, centered with a max width, built from existing shadcn/Tailwind v4
theme tokens (`bg-primary`, `bg-card`, `text-muted-foreground`, `chart-*`, `border`,
etc.). Default theme is light; markup stays theme-safe (no hardcoded colors).

Sections top to bottom:

1. **Sticky top bar** — "Future Finance" wordmark on the left, **Sign in** button on
   the right (`<a href="/api/auth/signin?callbackUrl=/">`).
2. **Hero** — headline ("See your future balance, day by day."), a one-line subhead
   describing the app as a forecaster that projects your account balance months ahead
   from recurring income and expenses, and a primary **Sign in** CTA.
3. **Visual preview** — a CSS-built mock forecast card: a stylized balance sparkline
   (an inline SVG polyline using `chart-*` tokens, rising then dipping) with a labeled
   "low point" marker. Pure markup — no external image, self-contained, theme-aware.
4. **Key features** — 4 cards:
   - Forecast months ahead
   - Recurring income & expenses
   - Business-day & holiday aware
   - Override any instance
5. **How it works** — 3-step strip: **1** Set your current balance → **2** Add your
   incomes & expenses → **3** Watch your balance forecast day by day.
6. **Footer CTA** — a closing line and one more Sign in button.

Copy stays accurate to the shipped single-user forecaster. No promises about
multi-account/collaboration (deferred features) on the marketing page.

## Out of scope

- No redesign of the dashboard or `/login`.
- No new auth provider or "sign up" flow — Google sign-in already creates the account
  on first use, so a single "Sign in" button is honest and sufficient.
- No real product screenshot asset; the preview is CSS/SVG only.

## Testing

Per repo conventions (pure-function tests only, no UI/integration scaffolding), this
change is UI-only and has no engine logic, so no new tests are added. Verified manually
on localhost: logged out at `/` shows the home page; logged in shows the dashboard.
