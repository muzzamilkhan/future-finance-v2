import { describe, it, expect } from "vitest";
import { createCreditAccountInput, updateCreditLimitInput } from "./account";

describe("credit account schemas", () => {
  it("accepts a valid credit account", () => {
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 5000, outstanding: 450 }).success).toBe(true);
  });
  it("rejects non-positive limit and negative outstanding", () => {
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 0, outstanding: 0 }).success).toBe(false);
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 5000, outstanding: -1 }).success).toBe(false);
  });
  it("updateCreditLimitInput requires a positive limit", () => {
    expect(updateCreditLimitInput.safeParse({ creditLimit: 100 }).success).toBe(true);
    expect(updateCreditLimitInput.safeParse({ creditLimit: -5 }).success).toBe(false);
  });
});
