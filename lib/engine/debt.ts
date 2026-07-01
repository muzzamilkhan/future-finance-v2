export type DebtInput = { id: string; name: string; balance: number; apr: number; minPayment: number };
export type Strategy = "SNOWBALL" | "AVALANCHE" | "CUSTOM";
export type PerDebtMonth = { id: string; startBalance: number; interest: number; payment: number; endBalance: number };
export type DebtMonth = {
  month: number;
  perDebt: PerDebtMonth[];
  totalBalance: number;
  totalInterest: number;
  totalPaid: number;
};
export type SimulateInput = {
  debts: DebtInput[];
  strategy: Strategy;
  extraPayment: number;
  customOrder?: string[];
  maxMonths?: number;
};
export type SimulateResult = {
  months: DebtMonth[];
  payoffMonth: number | null;
  totalInterest: number;
  totalPaid: number;
  perDebt: { id: string; payoffMonth: number | null; interestPaid: number }[];
};

const DEFAULT_MAX_MONTHS = 600;

export function orderDebts(debts: DebtInput[], strategy: Strategy, customOrder?: string[]): DebtInput[] {
  const indexed = debts.map((d, i) => ({ d, i }));
  if (strategy === "CUSTOM") {
    const rank = new Map((customOrder ?? []).map((id, i) => [id, i] as const));
    return indexed
      .sort((a, b) => {
        const ra = rank.has(a.d.id) ? rank.get(a.d.id)! : Number.POSITIVE_INFINITY;
        const rb = rank.has(b.d.id) ? rank.get(b.d.id)! : Number.POSITIVE_INFINITY;
        return ra - rb || a.i - b.i || a.d.id.localeCompare(b.d.id);
      })
      .map((x) => x.d);
  }
  const key = strategy === "SNOWBALL"
    ? (d: DebtInput) => d.balance
    : (d: DebtInput) => -d.apr; // AVALANCHE: descending apr
  return indexed
    .sort((a, b) => key(a.d) - key(b.d) || a.i - b.i || a.d.id.localeCompare(b.d.id))
    .map((x) => x.d);
}

type Live = { input: DebtInput; balance: number; interestPaid: number; payoffMonth: number | null };

function orderLive(live: Live[], strategy: Strategy, customOrder?: string[]): Live[] {
  const byId = new Map(live.map((l) => [l.input.id, l] as const));
  return orderDebts(live.map((l) => l.input), strategy, customOrder)
    .map((d) => byId.get(d.id)!)
    .filter((l) => l.balance > 0);
}

export function simulateDebtPayoff(input: SimulateInput): SimulateResult {
  const maxMonths = input.maxMonths ?? DEFAULT_MAX_MONTHS;
  const live: Live[] = input.debts.map((d) => ({
    input: d,
    balance: d.balance,
    interestPaid: 0,
    payoffMonth: d.balance <= 0 ? 0 : null,
  }));

  const months: DebtMonth[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let month = 0;

  while (live.some((l) => l.balance > 0) && month < maxMonths) {
    const rows = new Map<string, PerDebtMonth>();
    let monthInterest = 0;
    let monthPaid = 0;

    // Freed-up minimums from already-cleared debts feed the surplus pool.
    let surplus = input.extraPayment;
    for (const l of live) {
      if (l.balance <= 0) surplus += l.input.minPayment;
    }

    // 1) Accrue interest + pay minimums on each unpaid debt.
    for (const l of live) {
      const startBalance = l.balance;
      if (startBalance <= 0) {
        rows.set(l.input.id, { id: l.input.id, startBalance: 0, interest: 0, payment: 0, endBalance: 0 });
        continue;
      }
      const interest = startBalance * (l.input.apr / 12);
      const owed = startBalance + interest;
      const payment = Math.min(l.input.minPayment, owed);
      const endBalance = owed - payment;

      l.balance = endBalance;
      l.interestPaid += interest;
      monthInterest += interest;
      monthPaid += payment;
      rows.set(l.input.id, { id: l.input.id, startBalance, interest, payment, endBalance });
    }

    // 2) Apply surplus to strategy-ordered debts, cascading overflow.
    for (const l of orderLive(live, input.strategy, input.customOrder)) {
      if (surplus <= 0) break;
      if (l.balance <= 0) continue;
      const applied = Math.min(surplus, l.balance);
      l.balance -= applied;
      surplus -= applied;
      monthPaid += applied;
      const row = rows.get(l.input.id)!;
      row.payment += applied;
      row.endBalance = l.balance;
    }

    // 3) Mark newly-cleared debts.
    for (const l of live) {
      if (l.balance <= 0 && l.payoffMonth === null) l.payoffMonth = month + 1;
    }

    totalInterest += monthInterest;
    totalPaid += monthPaid;
    months.push({
      month,
      perDebt: input.debts.map((d) => rows.get(d.id)!),
      totalBalance: live.reduce((s, l) => s + Math.max(0, l.balance), 0),
      totalInterest: monthInterest,
      totalPaid: monthPaid,
    });
    month += 1;
  }

  const allClear = live.every((l) => l.balance <= 0);
  return {
    months,
    payoffMonth: allClear ? month : null,
    totalInterest,
    totalPaid,
    perDebt: live.map((l) => ({ id: l.input.id, payoffMonth: l.payoffMonth, interestPaid: l.interestPaid })),
  };
}
