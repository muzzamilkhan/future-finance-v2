"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListOrdered, CalendarDays, PieChart } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { AccountPicker } from "./AccountPicker";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/particulars", label: "Income & Expenses", icon: ListOrdered },
  { to: "/holidays", label: "Holidays", icon: CalendarDays },
  { to: "/spending", label: "Spending", icon: PieChart },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between p-4">
        <span className="font-bold">Future Finance</span>
        <ThemeToggle />
      </div>
      <div className="px-3 pb-2"><AccountPicker /></div>
      <nav className="flex flex-col gap-1 p-2">
        {items.map(({ to, label, icon: Icon }) => (
          <Link key={to} href={to}
            className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm",
              pathname === to ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50")}>
            <Icon className="h-4 w-4" />{label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
