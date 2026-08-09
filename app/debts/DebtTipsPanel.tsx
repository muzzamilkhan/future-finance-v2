"use client";

import type { DebtTips } from "@/lib/engine";
import { Card } from "@/app/_components/ui/card";
import { useFormatCurrency } from "@/app/_components/PreferencesContext";

function pluralMonths(n: number) {
  return `${n} ${n === 1 ? "month" : "months"}`;
}

export function DebtTipsPanel({ tips, extraPayment }: { tips: DebtTips; extraPayment: number }) {
  const fmt = useFormatCurrency();
  const lines: string[] = [];

  if (tips.recommendation.kind === "compare") {
    const r = tips.recommendation;
    const name = r.winner === "AVALANCHE" ? "Avalanche" : "Snowball";
    if (r.monthsSaved === 0) {
      lines.push(
        `${name} saves you ${fmt(r.interestSaved)} in interest (same debt-free timing).`,
      );
    } else {
      lines.push(
        `${name} clears your debt ${pluralMonths(r.monthsSaved)} sooner and saves ${fmt(r.interestSaved)} in interest.`,
      );
    }
  } else if (tips.recommendation.kind === "tie") {
    lines.push("Snowball and avalanche finish at the same time and cost — pick whichever keeps you motivated.");
  } else {
    lines.push("Your minimum payments don't cover the interest — increase your payments to start clearing debt.");
  }

  if (tips.nextTarget) {
    lines.push(`Put your extra payments toward ${tips.nextTarget.name} next.`);
  }

  if (tips.knobImpact.kind === "impact") {
    lines.push(
      `Your extra ${fmt(extraPayment)}/mo saves you ${pluralMonths(tips.knobImpact.monthsSaved)} and ${fmt(tips.knobImpact.interestSaved)}.`,
    );
  } else if (tips.knobImpact.kind === "none" && extraPayment > 0) {
    lines.push(`Your extra ${fmt(extraPayment)}/mo isn't changing the payoff — try a larger amount.`);
  }

  return (
    <Card className="grid gap-2 p-4">
      <p className="font-medium">Tips</p>
      {lines.map((l, i) => (
        <p key={i} className="text-sm text-muted-foreground">{l}</p>
      ))}
    </Card>
  );
}
