import { describe, it, expect } from "vitest";
import { formatCurrency } from "./formatCurrency";

describe("formatCurrency", () => {
  it("defaults to AUD in en-AU", () => {
    expect(formatCurrency(1500)).toBe("$1,500.00");
  });

  it("always shows exactly two decimals", () => {
    expect(formatCurrency(1500.5)).toBe("$1,500.50");
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats negatives", () => {
    expect(formatCurrency(-42.25)).toBe("-$42.25");
  });

  it("honours an explicit currency and locale", () => {
    expect(formatCurrency(1500, "USD", "en-US")).toBe("$1,500.00");
    expect(formatCurrency(1500, "GBP", "en-GB")).toBe("£1,500.00");
  });

  it("falls back to defaults when handed an invalid currency code", () => {
    expect(formatCurrency(1500, "not-a-code", "en-AU")).toBe("$1,500.00");
  });
});
