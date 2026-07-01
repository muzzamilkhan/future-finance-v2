import { describe, it, expect } from "vitest";
import { accountColorClass, ACCOUNT_COLORS, UNKNOWN_ACCOUNT_COLOR } from "./accountColor";

describe("accountColorClass", () => {
  const ids = ["a", "b", "c"];

  it("assigns palette entries by stable index order", () => {
    expect(accountColorClass("a", ids)).toBe(ACCOUNT_COLORS[0]);
    expect(accountColorClass("b", ids)).toBe(ACCOUNT_COLORS[1]);
    expect(accountColorClass("c", ids)).toBe(ACCOUNT_COLORS[2]);
  });

  it("is deterministic regardless of how many colors exist", () => {
    expect(accountColorClass("b", ids)).toBe(accountColorClass("b", ids));
  });

  it("wraps around when there are more accounts than colors", () => {
    const many = Array.from({ length: ACCOUNT_COLORS.length + 2 }, (_, i) => `id${i}`);
    const wrapped = many[ACCOUNT_COLORS.length]!;
    expect(accountColorClass(wrapped, many)).toBe(ACCOUNT_COLORS[0]);
  });

  it("falls back to a neutral class for an unknown id", () => {
    expect(accountColorClass("missing", ids)).toBe(UNKNOWN_ACCOUNT_COLOR);
  });
});
