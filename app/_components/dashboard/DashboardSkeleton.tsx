import { Card, CardContent, CardHeader } from "@/app/_components/ui/card";
import { Skeleton } from "@/app/_components/ui/skeleton";

/**
 * Placeholder shown while the combined forecast loads.
 *
 * The dashboard is a client component with no server-rendered data, so the browser
 * used to paint a single "Loading…" line and then nothing until the tRPC round trip
 * and the engine replay finished — LCP had nothing to land on until the very end.
 * This mirrors the real layout (heading, four metric cards, sparkline, day list) so
 * first paint carries the page's actual shape, and swapping in the real content
 * doesn't shift it.
 *
 * The static headings are rendered for real, not as bars — they cost nothing and
 * they are what the finished page shows anyway.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <CardHeader className="pb-1 sm:pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Skeleton className="mt-4 h-32 w-full" />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Daily Transactions</h2>
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <CardContent className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
