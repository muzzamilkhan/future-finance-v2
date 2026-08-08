"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { ThemeProvider } from "next-themes";
import { trpc } from "@/trpc/client";
import { AccountProvider } from "@/app/_components/AccountContext";
import { PreferencesProvider } from "@/app/_components/PreferencesContext";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <PreferencesProvider>
            <AccountProvider>{children}</AccountProvider>
          </PreferencesProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
