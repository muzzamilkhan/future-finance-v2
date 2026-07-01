import { describe, it, expect } from "vitest";
import { deriveTips } from "./debtTips";
import type { SimulateResult } from "./debt";

const empty = { months: [], totalPaid: 0, perDebt: [] };
const res = (payoffMonth: number | null, totalInterest: number): SimulateResult =>
  ({ ...empty, payoffMonth, totalInterest } as SimulateResult);

const debts = [
  { id: "a", name: "Visa", balance: 800, apr: 0.24, minPayment: 40 },
  { id: "b", name: "Loan", balance: 5000, apr: 0.05, minPayment: 150 },
];

describe("deriveTips", () => {
  it("recommends avalanche when it clears sooner and cheaper", () => {
    const tips = deriveTips({
      debts, activeStrategy: "AVALANCHE",
      snowball: res(30, 900), avalanche: res(23, 448),
      active: res(23, 448), activeNoExtra: res(31, 1678),
    });
    expect(tips.recommendation).toEqual({
      kind: "compare", winner: "AVALANCHE", monthsSaved: 7, interestSaved: 452,
    });
  });

  it("recommends snowball when it wins on interest", () => {
    const tips = deriveTips({
      debts, activeStrategy: "SNOWBALL",
      snowball: res(20, 300), avalanche: res(22, 350),
      active: res(20, 300), activeNoExtra: res(28, 900),
    });
    expect(tips.recommendation).toEqual({
      kind: "compare", winner: "SNOWBALL", monthsSaved: 2, interestSaved: 50,
    });
  });

  it("reports a tie when months and interest match", () => {
    const tips = deriveTips({
      debts, activeStrategy: "SNOWBALL",
      snowball: res(20, 300), avalanche: res(20, 300),
      active: res(20, 300), activeNoExtra: res(20, 300),
    });
    expect(tips.recommendation).toEqual({ kind: "tie" });
  });

  it("degrades to never-payoff when a strategy never clears", () => {
    const tips = deriveTips({
      debts, activeStrategy: "AVALANCHE",
      snowball: res(null, 5000), avalanche: res(null, 5000),
      active: res(null, 5000), activeNoExtra: res(null, 6000),
    });
    expect(tips.recommendation).toEqual({ kind: "never-payoff" });
    expect(tips.knobImpact).toEqual({ kind: "never-payoff" });
  });

  it("names the next target from the active strategy order (avalanche = highest apr)", () => {
    const tips = deriveTips({
      debts, activeStrategy: "AVALANCHE",
      snowball: res(30, 900), avalanche: res(23, 448),
      active: res(23, 448), activeNoExtra: res(31, 1678),
    });
    expect(tips.nextTarget).toEqual({ id: "a", name: "Visa" });
  });

  it("computes knob impact from active vs active-with-no-extra", () => {
    const tips = deriveTips({
      debts, activeStrategy: "AVALANCHE",
      snowball: res(30, 900), avalanche: res(23, 448),
      active: res(23, 448), activeNoExtra: res(31, 1678),
    });
    expect(tips.knobImpact).toEqual({ kind: "impact", monthsSaved: 8, interestSaved: 1230 });
  });

  it("reports no knob impact when extra changed nothing", () => {
    const tips = deriveTips({
      debts, activeStrategy: "SNOWBALL",
      snowball: res(20, 300), avalanche: res(22, 350),
      active: res(20, 300), activeNoExtra: res(20, 300),
    });
    expect(tips.knobImpact).toEqual({ kind: "none" });
  });
});
