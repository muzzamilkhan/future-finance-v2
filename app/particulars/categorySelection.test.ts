import { describe, expect, it } from "vitest";
import { creatableCategory, filterCategories } from "./categorySelection";

describe("filterCategories", () => {
  it("returns every option for an empty/whitespace query", () => {
    expect(filterCategories(["Rent", "Food"], "  ")).toEqual(["Rent", "Food"]);
  });

  it("matches as a case-insensitive substring", () => {
    expect(filterCategories(["Rent", "Groceries", "Gym"], "g")).toEqual(["Groceries", "Gym"]);
  });

  it("returns nothing when no option matches", () => {
    expect(filterCategories(["Rent", "Food"], "xyz")).toEqual([]);
  });
});

describe("creatableCategory", () => {
  it("offers the trimmed query when it isn't an existing option", () => {
    expect(creatableCategory(["Rent"], "  Travel ")).toBe("Travel");
  });

  it("offers nothing for an empty/whitespace query", () => {
    expect(creatableCategory(["Rent"], "   ")).toBeNull();
  });

  it("offers nothing when the query matches an option case-insensitively", () => {
    expect(creatableCategory(["Rent"], "rent")).toBeNull();
  });
});
