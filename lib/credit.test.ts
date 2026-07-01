import { describe, it, expect } from "vitest";
import { availableCredit, balanceFromAvailable } from "./credit";

describe("availableCredit", () => {
  it("derives available from limit + stored balance (outstanding is negative)", () => {
    expect(availableCredit(-200, 1000)).toBe(800);
  });
  it("is negative when over the limit (soft limit)", () => {
    expect(availableCredit(-1100, 1000)).toBe(-100);
  });
  it("equals the full limit when nothing is owed", () => {
    expect(availableCredit(0, 1000)).toBe(1000);
  });
});

describe("balanceFromAvailable", () => {
  it("converts an entered available-credit figure to the stored (negative) balance", () => {
    // available 800 on a 1000 limit => owed 200 => stored -200
    expect(balanceFromAvailable(800, 1000)).toBe(-200);
  });
  it("round-trips with availableCredit", () => {
    const stored = balanceFromAvailable(650, 1000);
    expect(stored).toBe(-350);
    expect(availableCredit(stored, 1000)).toBe(650);
  });
  it("allows available above the limit (owed goes positive / credit balance)", () => {
    expect(balanceFromAvailable(1200, 1000)).toBe(200);
  });
});
