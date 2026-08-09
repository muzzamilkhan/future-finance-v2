import { describe, it, expect } from "vitest";
import { pickTopmostVisible } from "./topmostVisibleDay";

describe("pickTopmostVisible", () => {
  const keys = ["2026-07-15", "2026-07-16", "2026-07-20"];

  it("returns the earliest key that is on screen", () => {
    expect(pickTopmostVisible(keys, new Set(["2026-07-16", "2026-07-20"]))).toBe("2026-07-16");
  });

  it("prefers document order, not the order things became visible", () => {
    expect(pickTopmostVisible(keys, new Set(["2026-07-20", "2026-07-15"]))).toBe("2026-07-15");
  });

  it("returns null when nothing is visible", () => {
    expect(pickTopmostVisible(keys, new Set())).toBeNull();
  });

  it("ignores visible keys that are no longer rendered", () => {
    expect(pickTopmostVisible(keys, new Set(["2026-06-01"]))).toBeNull();
  });
});
