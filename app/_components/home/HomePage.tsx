import {
  TrendingUp,
  Repeat,
  CalendarDays,
  SlidersHorizontal,
} from "lucide-react";
import { signInAction } from "@/app/_actions/auth";

function SignInButton({ className = "" }: { className?: string }) {
  return (
    <form action={signInAction} className="inline-block">
      <button
        type="submit"
        className={`inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 ${className}`}
      >
        Sign in
      </button>
    </form>
  );
}

const FEATURES = [
  {
    icon: TrendingUp,
    title: "Forecast months ahead",
    body: "Project your account balance day by day, so you can see what's coming before it arrives.",
  },
  {
    icon: Repeat,
    title: "Recurring income & expenses",
    body: "Add your pay, rent, subscriptions and bills once — weekly, fortnightly, monthly or annual.",
  },
  {
    icon: CalendarDays,
    title: "Business-day & holiday aware",
    body: "Payments shift around weekends and public holidays, just like they do in real life.",
  },
  {
    icon: SlidersHorizontal,
    title: "Override any instance",
    body: "A one-off different amount or date? Adjust a single occurrence without touching the rest.",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Set your current balance",
    body: "Start from what's actually in your account today.",
  },
  {
    n: "2",
    title: "Add your incomes & expenses",
    body: "Enter the money coming in and going out, and how often.",
  },
  {
    n: "3",
    title: "See your balance forecast",
    body: "Watch your projected balance play out day by day into the future.",
  },
];

function PreviewCard() {
  // Stylized forecast sparkline: rises, dips to a low point, recovers.
  const points = "0,60 40,48 80,52 120,30 160,38 200,72 240,64 280,44 320,24";
  const lowX = 200;
  const lowY = 72;
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Projected balance</p>
          <p className="text-2xl font-semibold">$4,280</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
          6 months
        </span>
      </div>
      <svg
        viewBox="0 0 320 90"
        className="h-32 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Example balance forecast trending up with a dip"
      >
        <polyline
          points={points}
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lowX} cy={lowY} r="4" fill="var(--chart-1)" />
      </svg>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: "var(--chart-1)" }}
        />
        Lowest point flagged before it happens
      </div>
    </div>
  );
}

export function HomePage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 md:px-6">
          <span className="font-bold">Future Finance</span>
          <SignInButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 md:px-6">
        {/* Hero */}
        <section className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
          <div>
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
              See your future balance, day by day.
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Future Finance forecasts your account balance months ahead from your
              recurring income and expenses — so you always know what's coming.
            </p>
            <div className="mt-8">
              <SignInButton className="px-6 py-3 text-base" />
            </div>
          </div>
          <PreviewCard />
        </section>

        {/* Features */}
        <section className="py-8">
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border bg-card p-5">
                <div className="mb-3 inline-flex rounded-lg bg-primary/10 p-2 text-primary">
                  <Icon className="size-5" />
                </div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="py-12">
          <h2 className="text-center text-2xl font-semibold">How it works</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {STEPS.map(({ n, title, body }) => (
              <div key={n} className="text-center">
                <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">
                  {n}
                </div>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer CTA */}
        <section className="border-t py-16 text-center">
          <h2 className="text-2xl font-semibold">Know your numbers before they land.</h2>
          <p className="mt-2 text-muted-foreground">
            Sign in and start forecasting in minutes.
          </p>
          <div className="mt-6">
            <SignInButton className="px-6 py-3 text-base" />
          </div>
        </section>
      </main>
    </div>
  );
}
