import { describe, it, expect } from "vitest";
import { normalizeCategory, parseCategories, serializeCategories } from "./category";

describe("normalizeCategory", () => {
  it("trims, collapses whitespace, title-cases", () => {
    expect(normalizeCategory("  groceries  ")).toBe("Groceries");
    expect(normalizeCategory("home   loan")).toBe("Home Loan");
    expect(normalizeCategory("EATING out")).toBe("Eating Out");
  });
  it("returns empty string for blank", () => {
    expect(normalizeCategory("   ")).toBe("");
    expect(normalizeCategory("")).toBe("");
  });
  it("strips commas so a category name can't corrupt the CSV cache", () => {
    expect(normalizeCategory("food, drink")).toBe("Food Drink");
  });
});

describe("parseCategories", () => {
  it("splits, normalizes, drops blanks, dedupes case-insensitively, sorts", () => {
    expect(parseCategories("groceries, Travel ,, GROCERIES, bills")).toEqual([
      "Bills", "Groceries", "Travel",
    ]);
  });
  it("returns [] for empty input", () => {
    expect(parseCategories("")).toEqual([]);
  });
});

describe("serializeCategories", () => {
  it("normalizes, dedupes, sorts, joins with comma", () => {
    expect(serializeCategories(["Travel", "bills", "Bills"])).toBe("Bills,Travel");
  });
  it("returns empty string for no names", () => {
    expect(serializeCategories([])).toBe("");
  });
});
