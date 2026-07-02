import { describe, it, expect } from "vitest";
import { createCreditAccountInput, updateAccountInput } from "./account";

describe("credit account schemas", () => {
  it("accepts a valid credit account", () => {
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 5000, outstanding: 450 }).success).toBe(true);
  });
  it("rejects non-positive limit and negative outstanding", () => {
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 0, outstanding: 0 }).success).toBe(false);
    expect(createCreditAccountInput.safeParse({ name: "Visa", creditLimit: 5000, outstanding: -1 }).success).toBe(false);
  });
});

describe("updateAccountInput", () => {
  it("accepts a name alone (debit)", () => {
    expect(updateAccountInput.safeParse({ name: "Everyday" }).success).toBe(true);
  });
  it("accepts a name with a positive credit limit", () => {
    expect(updateAccountInput.safeParse({ name: "Visa", creditLimit: 5000 }).success).toBe(true);
  });
  it("rejects an empty name and an over-long name", () => {
    expect(updateAccountInput.safeParse({ name: "" }).success).toBe(false);
    expect(updateAccountInput.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("rejects a non-positive credit limit", () => {
    expect(updateAccountInput.safeParse({ name: "Visa", creditLimit: 0 }).success).toBe(false);
    expect(updateAccountInput.safeParse({ name: "Visa", creditLimit: -5 }).success).toBe(false);
  });
});
