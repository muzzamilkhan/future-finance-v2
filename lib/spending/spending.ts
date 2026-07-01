export type RecurrenceFrequency =
  | "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL";
export type ParticularType = "INCOME" | "EXPENSE";

export type SpendingParticular = {
  type: ParticularType;
  amount: number;
  frequency: RecurrenceFrequency;
  category?: string | null;
};

export type SpendingCategory = { name: string; monthly: number };
export type SpendingSummary = {
  categories: SpendingCategory[];
  untagged: number;
  totalExpense: number;
  monthlyIncome: number;
  surplus: number;
};

export function toMonthly(amount: number, frequency: RecurrenceFrequency): number {
  switch (frequency) {
    case "WEEKLY": return amount * 52 / 12;
    case "FORTNIGHTLY": return amount * 26 / 12;
    case "MONTHLY": return amount;
    case "ANNUAL": return amount / 12;
    case "ONCE_OFF": return 0;
  }
}

export function buildSpending(particulars: SpendingParticular[]): SpendingSummary {
  const byCategory = new Map<string, number>();
  let untagged = 0;
  let totalExpense = 0;
  let monthlyIncome = 0;

  for (const p of particulars) {
    const monthly = toMonthly(Math.abs(p.amount), p.frequency);
    if (monthly === 0) continue;
    if (p.type === "INCOME") {
      monthlyIncome += monthly;
      continue;
    }
    totalExpense += monthly;
    const name = p.category ?? "";
    if (name === "") {
      untagged += monthly;
    } else {
      byCategory.set(name, (byCategory.get(name) ?? 0) + monthly);
    }
  }

  const categories = [...byCategory.entries()]
    .map(([name, monthly]) => ({ name, monthly }))
    .sort((a, b) => b.monthly - a.monthly || a.name.localeCompare(b.name));

  return {
    categories,
    untagged,
    totalExpense,
    monthlyIncome,
    surplus: monthlyIncome - totalExpense,
  };
}
