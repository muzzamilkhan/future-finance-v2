import { describe, it, expect } from "vitest";
import { simulateDebtPayoff, orderDebts } from "./debt";

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

describe("simulateDebtPayoff — surplus, rollover, cascade", () => {
  const round = (n: number) => Math.round(n * 100) / 100;

  it("applies extraPayment to the target debt on top of its minimum", () => {
    // 0% APR. minPayment 100 + extra 100 = 200/mo on the single debt.
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "L", balance: 1000, apr: 0, minPayment: 100 }],
      strategy: "SNOWBALL",
      extraPayment: 100,
    });
    expect(r.payoffMonth).toBe(5); // 1000 / 200
  });

  it("cascades surplus overflow to the next debt within the same month", () => {
    // Debt a: balance 100, min 0. Debt b: balance 1000, min 0. extra 300, 0% apr.
    // Month 0: a needs 100 -> cleared, 200 overflow cascades to b -> b 800.
    const r = simulateDebtPayoff({
      debts: [
        { id: "a", name: "A", balance: 100, apr: 0, minPayment: 0 },
        { id: "b", name: "B", balance: 1000, apr: 0, minPayment: 0 },
      ],
      strategy: "SNOWBALL",
      extraPayment: 300,
    });
    const m0 = r.months[0]!;
    const a0 = m0.perDebt.find((p) => p.id === "a")!;
    const b0 = m0.perDebt.find((p) => p.id === "b")!;
    expect(round(a0.endBalance)).toBe(0);
    expect(round(b0.endBalance)).toBe(800);
  });

  it("rolls a cleared debt's minimum into the surplus pool from the next month", () => {
    // a: balance 100, min 100 (clears month 0). b: balance 1000, min 100, 0% apr, extra 0.
    // Month 0: a pays 100 -> cleared; b pays 100 -> 900.
    // Month 1: a's freed 100 rolls onto b's target -> b pays 100 min + 100 rollover = 200 -> 700.
    const r = simulateDebtPayoff({
      debts: [
        { id: "a", name: "A", balance: 100, apr: 0, minPayment: 100 },
        { id: "b", name: "B", balance: 1000, apr: 0, minPayment: 100 },
      ],
      strategy: "SNOWBALL",
      extraPayment: 0,
    });
    const b1 = r.months[1]!.perDebt.find((p) => p.id === "b")!;
    expect(round(b1.payment)).toBe(200);
    expect(round(b1.endBalance)).toBe(700);
  });

  it("returns payoffMonth null when minimums+extra never cover interest", () => {
    // 10000 @ 24% APR = 2%/mo = 200 interest. min 100, extra 0 -> balance grows.
    const r = simulateDebtPayoff({
      debts: [{ id: "a", name: "Bad", balance: 10000, apr: 0.24, minPayment: 100 }],
      strategy: "SNOWBALL",
      extraPayment: 0,
      maxMonths: 12,
    });
    expect(r.payoffMonth).toBeNull();
    expect(r.perDebt[0]!.payoffMonth).toBeNull();
    expect(r.months.length).toBe(12);
  });

  it("holds totalPaid == sum(startBalance) + totalInterest across multiple debts", () => {
    const r = simulateDebtPayoff({
      debts: [
        { id: "a", name: "A", balance: 500, apr: 0.1, minPayment: 80 },
        { id: "b", name: "B", balance: 1500, apr: 0.18, minPayment: 120 },
      ],
      strategy: "SNOWBALL",
      extraPayment: 200,
    });
    expect(round(r.totalPaid)).toBe(round(2000 + r.totalInterest));
  });
});

describe("orderDebts", () => {
  const debts = [
    { id: "big-low", name: "Mortgage", balance: 20000, apr: 0.05, minPayment: 300 },
    { id: "small-high", name: "Card", balance: 800, apr: 0.24, minPayment: 40 },
    { id: "mid", name: "Loan", balance: 5000, apr: 0.12, minPayment: 150 },
  ];

  it("SNOWBALL orders by ascending balance", () => {
    expect(orderDebts(debts, "SNOWBALL").map((d) => d.id)).toEqual(["small-high", "mid", "big-low"]);
  });
  it("AVALANCHE orders by descending apr", () => {
    expect(orderDebts(debts, "AVALANCHE").map((d) => d.id)).toEqual(["small-high", "mid", "big-low"]);
  });
  it("CUSTOM follows customOrder, unlisted ids to the end", () => {
    expect(orderDebts(debts, "CUSTOM", ["mid", "big-low"]).map((d) => d.id)).toEqual(["mid", "big-low", "small-high"]);
  });

  it("breaks balance ties by input order (stable)", () => {
    const tied = [
      { id: "x", name: "X", balance: 1000, apr: 0.1, minPayment: 50 },
      { id: "y", name: "Y", balance: 1000, apr: 0.2, minPayment: 50 },
    ];
    expect(orderDebts(tied, "SNOWBALL").map((d) => d.id)).toEqual(["x", "y"]);
  });
  it("breaks apr ties by input order (stable)", () => {
    const tied = [
      { id: "x", name: "X", balance: 1000, apr: 0.1, minPayment: 50 },
      { id: "y", name: "Y", balance: 500, apr: 0.1, minPayment: 50 },
    ];
    expect(orderDebts(tied, "AVALANCHE").map((d) => d.id)).toEqual(["x", "y"]);
  });
});

describe("simulateDebtPayoff — strategy affects payoff order", () => {
  // NOTE: balance 500 (brief) caused both to clear the same month (10) under AVALANCHE due to cascade
  // overflow; raised to 1000 so the strategies produce strictly different payoff months.
  const debts = [
    { id: "small", name: "Small", balance: 1000, apr: 0.05, minPayment: 50 },
    { id: "pricey", name: "Pricey", balance: 2000, apr: 0.3, minPayment: 50 },
  ];

  it("snowball clears the smallest-balance debt first", () => {
    const r = simulateDebtPayoff({ debts, strategy: "SNOWBALL", extraPayment: 200 });
    const small = r.perDebt.find((p) => p.id === "small")!;
    const pricey = r.perDebt.find((p) => p.id === "pricey")!;
    expect(small.payoffMonth!).toBeLessThan(pricey.payoffMonth!);
  });
  it("avalanche clears the highest-apr debt first", () => {
    const r = simulateDebtPayoff({ debts, strategy: "AVALANCHE", extraPayment: 200 });
    const small = r.perDebt.find((p) => p.id === "small")!;
    const pricey = r.perDebt.find((p) => p.id === "pricey")!;
    expect(pricey.payoffMonth!).toBeLessThan(small.payoffMonth!);
  });
});
