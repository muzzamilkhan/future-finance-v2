import { describe, it, expect } from "vitest";
import { computeUserCategories } from "./categorySync";

describe("computeUserCategories", () => {
  it("serializes distinct non-null expense categories, sorted", () => {
    expect(computeUserCategories(["Rent", "Groceries", "Rent", null])).toBe("Groceries,Rent");
  });
  it("drops nulls and blanks; returns empty string when none", () => {
    expect(computeUserCategories([null, "", "  "])).toBe("");
    expect(computeUserCategories([])).toBe("");
  });
});
