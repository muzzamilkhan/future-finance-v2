import { describe, it, expect } from "vitest";
import { sortDailyEvents } from "./sortEvents";
import type { DailyEvent } from "@/lib/engine";

const ev = (name: string, kind: "income" | "expense", amount: number): DailyEvent => ({
  particularId: name, name, amount, kind,
  isOverridden: false, isSkipped: false, isMovedDueToHoliday: false,
});

describe("sortDailyEvents", () => {
  it("puts income before expenses, each descending by amount", () => {
    const input = [
      ev("small-exp", "expense", -50),
      ev("big-inc", "income", 900),
      ev("big-exp", "expense", -400),
      ev("small-inc", "income", 100),
    ];
    const out = sortDailyEvents(input).map((e) => e.name);
    // income desc: 900, 100; then expenses desc by signed amount: -50, -400
    expect(out).toEqual(["big-inc", "small-inc", "small-exp", "big-exp"]);
  });

  it("does not mutate the input array", () => {
    const input = [ev("b", "income", 1), ev("a", "income", 2)];
    const copy = [...input];
    sortDailyEvents(input);
    expect(input).toEqual(copy);
  });
});
