import { describe, it, expect } from "vitest";
import { pickDefaultAccountId } from "./AccountContext";

describe("pickDefaultAccountId", () => {
  it("returns the isDefault account", () => {
    expect(pickDefaultAccountId([
      { id: "a", isDefault: false },
      { id: "b", isDefault: true },
    ])).toBe("b");
  });
  it("falls back to the first account when none is default", () => {
    expect(pickDefaultAccountId([
      { id: "a", isDefault: false },
      { id: "b", isDefault: false },
    ])).toBe("a");
  });
  it("returns null when there are no accounts", () => {
    expect(pickDefaultAccountId([])).toBeNull();
  });
});
