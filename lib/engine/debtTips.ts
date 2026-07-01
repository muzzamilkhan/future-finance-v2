import type { DebtInput, SimulateResult, Strategy } from "./debt";
import { orderDebts } from "./debt";

export type DebtTips = {
  recommendation:
    | { kind: "compare"; winner: "SNOWBALL" | "AVALANCHE"; monthsSaved: number; interestSaved: number }
    | { kind: "tie" }
    | { kind: "never-payoff" };
  nextTarget: { id: string; name: string } | null;
  knobImpact:
    | { kind: "impact"; monthsSaved: number; interestSaved: number }
    | { kind: "none" }
    | { kind: "never-payoff" };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function deriveTips(args: {
  debts: DebtInput[];
  activeStrategy: Strategy;
  customOrder?: string[];
  snowball: SimulateResult;
  avalanche: SimulateResult;
  active: SimulateResult;
  activeNoExtra: SimulateResult;
}): DebtTips {
  const { snowball, avalanche, active, activeNoExtra } = args;

  // Recommendation: snowball vs avalanche.
  let recommendation: DebtTips["recommendation"];
  if (snowball.payoffMonth === null || avalanche.payoffMonth === null) {
    recommendation = { kind: "never-payoff" };
  } else if (
    snowball.payoffMonth === avalanche.payoffMonth &&
    round2(snowball.totalInterest) === round2(avalanche.totalInterest)
  ) {
    recommendation = { kind: "tie" };
  } else {
    // Winner: fewer months, then less interest.
    const avalancheWins =
      avalanche.payoffMonth < snowball.payoffMonth ||
      (avalanche.payoffMonth === snowball.payoffMonth &&
        avalanche.totalInterest <= snowball.totalInterest);
    const winner = avalancheWins ? "AVALANCHE" : "SNOWBALL";
    const [win, lose] = avalancheWins ? [avalanche, snowball] : [snowball, avalanche];
    recommendation = {
      kind: "compare",
      winner,
      monthsSaved: lose.payoffMonth! - win.payoffMonth!,
      interestSaved: round2(lose.totalInterest - win.totalInterest),
    };
  }

  // Next target: first debt in the active strategy's order.
  const ordered = orderDebts(args.debts, args.activeStrategy, args.customOrder);
  const first = ordered[0];
  const nextTarget = first ? { id: first.id, name: first.name } : null;

  // Knob impact: active (with extra) vs active (no extra).
  let knobImpact: DebtTips["knobImpact"];
  if (active.payoffMonth === null || activeNoExtra.payoffMonth === null) {
    knobImpact = { kind: "never-payoff" };
  } else {
    const monthsSaved = activeNoExtra.payoffMonth - active.payoffMonth;
    const interestSaved = round2(activeNoExtra.totalInterest - active.totalInterest);
    knobImpact = monthsSaved === 0 && interestSaved === 0
      ? { kind: "none" }
      : { kind: "impact", monthsSaved, interestSaved };
  }

  return { recommendation, nextTarget, knobImpact };
}
