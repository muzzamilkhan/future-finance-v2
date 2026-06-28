import { describe, it, expect } from "vitest";
import { formatCurrency, getAmountColorClass } from "./design-system";

describe("formatCurrency", () => {
  it("formats NZD with two decimals", () => {
    expect(formatCurrency(1500)).toBe("$1,500.00");
  });
});

describe("getAmountColorClass", () => {
  it("returns income class for positive amounts", () => {
    expect(getAmountColorClass(10)).toBe("text-finance-income");
  });
  it("returns expense class for negative amounts", () => {
    expect(getAmountColorClass(-10)).toBe("text-finance-expense");
  });
});
