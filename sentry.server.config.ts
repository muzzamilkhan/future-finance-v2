import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // NOTE: do not turn on `includeLocalVariables`. It attaches the Node inspector
  // (the "Debugger listening on ws://..." line in the function logs) on every cold
  // start, and V8 disables optimisations while a debugger is attached — it slowed
  // every request in the middleware and /api/trpc functions, not just cold ones.
});
