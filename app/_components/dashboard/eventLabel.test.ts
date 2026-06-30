import { describe, it, expect } from "vitest";
import { eventLabel } from "./eventLabel";

const names = new Map([["debit", "My Account"], ["credit", "Visa"]]);

describe("eventLabel", () => {
  it("returns the plain name for a non-transfer", () => {
    expect(eventLabel({ name: "Rent", fromAccountId: "debit", toAccountId: null }, names)).toBe("Rent");
  });
  it("renders a transfer as from -> to", () => {
    expect(eventLabel({ name: "Card payment", fromAccountId: "debit", toAccountId: "credit" }, names)).toBe("My Account -> Visa");
  });
  it("falls back to ? when a name is missing or map absent", () => {
    expect(eventLabel({ name: "x", fromAccountId: "debit", toAccountId: "gone" }, names)).toBe("My Account -> ?");
    expect(eventLabel({ name: "x", fromAccountId: "debit", toAccountId: "credit" }, undefined)).toBe("? -> ?");
  });
});
