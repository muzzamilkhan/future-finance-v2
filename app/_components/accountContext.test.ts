import { describe, it, expect } from "vitest";
import { pickInitialAccountId } from "./AccountContext";

describe("pickInitialAccountId", () => {
  const accts = [{ id: "a", isDefault: false }, { id: "b", isDefault: true }];
  it("uses stored id when still present", () => expect(pickInitialAccountId(accts, "a")).toBe("a"));
  it("falls back to default when stored is gone", () => expect(pickInitialAccountId(accts, "zzz")).toBe("b"));
  it("falls back to first when no default", () =>
    expect(pickInitialAccountId([{ id: "a", isDefault: false }], null)).toBe("a"));
  it("null when empty", () => expect(pickInitialAccountId([], null)).toBeNull());
});
