import { describe, it, expect } from "vitest";
import { currencyForCountry, CURRENCY_OPTIONS } from "./currencyForCountry";

describe("currencyForCountry", () => {
  it("maps known regions to their currency", () => {
    expect(currencyForCountry("AU")).toBe("AUD");
    expect(currencyForCountry("NZ")).toBe("NZD");
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry("GB")).toBe("GBP");
    expect(currencyForCountry("DE")).toBe("EUR");
  });

  it("is case-insensitive", () => {
    expect(currencyForCountry("au")).toBe("AUD");
  });

  it("falls back to the default for unknown or missing regions", () => {
    expect(currencyForCountry("ZZ")).toBe("AUD");
    expect(currencyForCountry(undefined)).toBe("AUD");
    expect(currencyForCountry("")).toBe("AUD");
  });
});

describe("CURRENCY_OPTIONS", () => {
  it("has no duplicate codes", () => {
    const codes = CURRENCY_OPTIONS.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes the default currency", () => {
    expect(CURRENCY_OPTIONS.some((o) => o.code === "AUD")).toBe(true);
  });

  it("uses 3-letter uppercase ISO codes", () => {
    for (const o of CURRENCY_OPTIONS) expect(o.code).toMatch(/^[A-Z]{3}$/);
  });
});
