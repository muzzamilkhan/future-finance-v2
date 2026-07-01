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

type Live = { input: DebtInput; balance: number; interestPaid: number; payoffMonth: number | null };

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
    const perDebt: PerDebtMonth[] = [];
    let monthInterest = 0;
    let monthPaid = 0;

    for (const l of live) {
      const startBalance = l.balance;
      if (startBalance <= 0) {
        perDebt.push({ id: l.input.id, startBalance: 0, interest: 0, payment: 0, endBalance: 0 });
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
      if (endBalance <= 0 && l.payoffMonth === null) l.payoffMonth = month + 1;

      perDebt.push({ id: l.input.id, startBalance, interest, payment, endBalance });
    }

    totalInterest += monthInterest;
    totalPaid += monthPaid;
    months.push({
      month,
      perDebt,
      totalBalance: live.reduce((s, l) => s + l.balance, 0),
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
