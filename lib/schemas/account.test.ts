import { describe, it, expect } from "vitest";
import { createAccountInput, createCreditAccountInput, updateAccountInput } from "./account";

describe("createAccountInput", () => {
  it("defaults the initial balance to 0", () => {
    const parsed = createAccountInput.parse({ name: "Everyday" });
    expect(parsed.initialBalance).toBe(0);
  });
  it("accepts an explicit initial balance, including negative", () => {
    expect(createAccountInput.parse({ name: "Everyday", initialBalance: 1200 }).initialBalance).toBe(1200);
    expect(createAccountInput.parse({ name: "Everyday", initialBalance: -50 }).initialBalance).toBe(-50);
  });
  it("rejects an empty name", () => {
    expect(createAccountInput.safeParse({ name: "" }).success).toBe(false);
  });
});

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
  it("accepts a debit balance, including negative", () => {
    expect(updateAccountInput.safeParse({ name: "Everyday", balance: 800 }).success).toBe(true);
    expect(updateAccountInput.safeParse({ name: "Everyday", balance: -120 }).success).toBe(true);
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
