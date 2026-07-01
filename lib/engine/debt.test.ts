import { describe, it, expect } from "vitest";
import { simulateDebtPayoff } from "./debt";

const round = (n: number) => Math.round(n * 100) / 100;

describe("simulateDebtPayoff — single debt, minimums only", () => {
  it("pays off a 0% APR debt in ceil(balance / minPayment) months", () => {
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Loan", balance: 1000, apr: 0, minPayment: 250 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    expect(r.payoffMonth).toBe(4);
    expect(r.perDebt).toEqual([{ id: "a", payoffMonth: 4, interestPaid: 0 }]);
    expect(round(r.totalInterest)).toBe(0);
    expect(round(r.totalPaid)).toBe(1000);
  });

  it("accrues monthly interest at apr/12 on the outstanding balance", () => {
    // 1200 @ 12% APR = 1% monthly. Month 1: interest = 12.00, pay 200 -> balance 1012.
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Card", balance: 1200, apr: 0.12, minPayment: 200 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    const m0 = r.months[0]!;
    expect(round(m0.perDebt[0]!.interest)).toBe(12);
    expect(round(m0.perDebt[0]!.startBalance)).toBe(1200);
    expect(round(m0.perDebt[0]!.payment)).toBe(200);
    expect(round(m0.perDebt[0]!.endBalance)).toBe(1012);
  });

  it("clears immediately when minPayment exceeds balance+interest in month 0", () => {
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Tiny", balance: 50, apr: 0.2, minPayment: 500 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    expect(r.payoffMonth).toBe(1);
    // pays only what is owed, never more than balance + interest
    expect(round(r.months[0]!.perDebt[0]!.payment)).toBe(round(50 + 50 * 0.2 / 12));
    expect(round(r.months[0]!.perDebt[0]!.endBalance)).toBe(0);
  });

  it("keeps the invariant totalPaid == startBalance + totalInterest", () => {
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Card", balance: 1200, apr: 0.12, minPayment: 200 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    expect(round(r.totalPaid)).toBe(round(1200 + r.totalInterest));
  });
});
