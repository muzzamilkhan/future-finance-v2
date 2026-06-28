"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListOrdered, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/particulars", label: "Items", icon: ListOrdered },
  { to: "/holidays", label: "Holidays", icon: CalendarDays },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t bg-background md:hidden">
      {items.map(({ to, label, icon: Icon }) => (
        <Link key={to} href={to}
          className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-xs",
            pathname === to ? "text-foreground" : "text-muted-foreground")}>
          <Icon className="h-5 w-5" />{label}
        </Link>
      ))}
    </nav>
  );
}
