"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { LayoutDashboard, ListOrdered, CalendarDays, PieChart, Sun, Moon, TrendingDown, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/particulars", label: "Items", icon: ListOrdered },
  { to: "/holidays", label: "Holidays", icon: CalendarDays },
  { to: "/spending", label: "Spending", icon: PieChart },
  { to: "/debts", label: "Debts", icon: TrendingDown },
  { to: "/accounts", label: "Accounts", icon: Wallet },
];

const itemClass = "flex min-w-[5rem] flex-1 flex-col items-center gap-1 py-2 text-xs";

export function BottomNav() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex overflow-x-auto border-t bg-background md:hidden">
      {items.map(({ to, label, icon: Icon }) => (
        <Link key={to} href={to}
          className={cn(itemClass,
            pathname === to ? "text-foreground" : "text-muted-foreground")}>
          <Icon className="h-5 w-5" />{label}
        </Link>
      ))}
      <button
        type="button"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className={cn(itemClass, "text-muted-foreground")}
        aria-label="Toggle theme"
      >
        <Sun className="h-5 w-5 dark:hidden" />
        <Moon className="hidden h-5 w-5 dark:block" />
        Theme
      </button>
    </nav>
  );
}
