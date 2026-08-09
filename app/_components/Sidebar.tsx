"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListOrdered, CalendarDays, PieChart, TrendingDown, Wallet, LogOut, Settings } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/app/_actions/auth";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/particulars", label: "Items", icon: ListOrdered },
  { to: "/holidays", label: "Holidays", icon: CalendarDays },
  { to: "/spending", label: "Spending", icon: PieChart },
  { to: "/debts", label: "Debts", icon: TrendingDown },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/preferences", label: "Preferences", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between p-4">
        <span className="font-bold">Future Finance</span>
        <ThemeToggle />
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {items.map(({ to, label, icon: Icon }) => (
          <Link key={to} href={to}
            className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm",
              pathname === to ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50")}>
            <Icon className="h-4 w-4" />{label}
          </Link>
        ))}
      </nav>
      <form action={signOutAction} className="mt-auto m-2">
        <button type="submit"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent/50">
          <LogOut className="h-4 w-4" />Log out
        </button>
      </form>
    </aside>
  );
}
