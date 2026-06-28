"use client";

import { Button } from "@/app/_components/ui/button";

export function SkipTodayButton({ skipToday, onToggle }: { skipToday: boolean; onToggle: () => void }) {
  return (
    <Button variant={skipToday ? "default" : "outline"} size="sm" onClick={onToggle}>
      {skipToday ? "Skipping today" : "Skip today"}
    </Button>
  );
}
