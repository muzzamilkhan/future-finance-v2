import { describe, it, expect } from "vitest";
import { getAmountColorClass } from "./design-system";

describe("getAmountColorClass", () => {
  it("returns income class for positive amounts", () => {
    expect(getAmountColorClass(10)).toBe("text-finance-income");
  });
  it("returns expense class for negative amounts", () => {
    expect(getAmountColorClass(-10)).toBe("text-finance-expense");
  });
});
