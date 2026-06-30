import { describe, it, expect } from "vitest";
import { pickNextDefault } from "./defaultAccount";

describe("pickNextDefault", () => {
  const m = (accountId: string, isDefault = false, closedAt: Date | null = null) => ({ accountId, isDefault, closedAt });
  it("returns the first other open account when closing the default", () => {
    expect(pickNextDefault([m("a", true), m("b"), m("c")], "a")).toBe("b");
  });
  it("skips closed accounts", () => {
    expect(pickNextDefault([m("a", true), m("b", false, new Date()), m("c")], "a")).toBe("c");
  });
  it("returns null when no other open account remains", () => {
    expect(pickNextDefault([m("a", true), m("b", false, new Date())], "a")).toBeNull();
  });
  it("returns null when closing the only account", () => {
    expect(pickNextDefault([m("a", true)], "a")).toBeNull();
  });
});
