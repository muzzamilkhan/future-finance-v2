import { describe, expect, it } from "vitest";
import { chipList, commitNewCategory, toggleChip } from "./categorySelection";

describe("toggleChip", () => {
  it("selects a chip that isn't the current one", () => {
    expect(toggleChip("Groceries", "Rent")).toBe("Rent");
  });

  it("clears to untagged when clicking the active chip", () => {
    expect(toggleChip("Rent", "Rent")).toBe("");
  });

  it("selects a chip when nothing is currently tagged", () => {
    expect(toggleChip("", "Rent")).toBe("Rent");
  });
});

describe("commitNewCategory", () => {
  it("returns the trimmed new category", () => {
    expect(commitNewCategory("", "  Travel  ")).toBe("Travel");
  });

  it("is a no-op for empty/whitespace input", () => {
    expect(commitNewCategory("Rent", "   ")).toBe("Rent");
  });

  it("selects an existing name without duplicating it", () => {
    expect(commitNewCategory("", "Rent")).toBe("Rent");
  });
});

describe("chipList", () => {
  it("returns the existing options unchanged when current is among them", () => {
    expect(chipList(["Rent", "Food"], "Rent")).toEqual(["Rent", "Food"]);
  });

  it("returns the existing options when untagged", () => {
    expect(chipList(["Rent", "Food"], "")).toEqual(["Rent", "Food"]);
  });

  it("appends the current value when it isn't in the options yet", () => {
    expect(chipList(["Rent", "Food"], "Travel")).toEqual(["Rent", "Food", "Travel"]);
  });
});
