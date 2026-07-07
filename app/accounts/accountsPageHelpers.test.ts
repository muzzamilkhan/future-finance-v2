import { describe, it, expect } from "vitest";
import { groupAccounts, parseCreditLimit, parseBalance, parseOutstanding } from "./accountsPageHelpers";
import type { AccountListItem } from "@/app/_components/AccountContext";

const base: Omit<AccountListItem, "id" | "role"> = {
  name: "A", currentBalance: 0, balanceUpdatedAt: new Date(0),
  type: "DEBIT", creditLimit: null, isDefault: false,
  canEditItems: false, canEditOverrides: false, canUpdateBalance: false,
};
const acct = (id: string, role: "OWNER" | "MEMBER"): AccountListItem => ({ ...base, id, role });

describe("groupAccounts", () => {
  it("splits by role preserving order", () => {
    const accounts = [acct("1", "OWNER"), acct("2", "MEMBER"), acct("3", "OWNER")];
    expect(groupAccounts(accounts)).toEqual({
      owned: [accounts[0], accounts[2]],
      shared: [accounts[1]],
    });
  });
  it("handles empty", () => {
    expect(groupAccounts([])).toEqual({ owned: [], shared: [] });
  });
});

describe("parseCreditLimit", () => {
  it("accepts positive numbers", () => {
    expect(parseCreditLimit("5000")).toBe(5000);
    expect(parseCreditLimit("  1200.50 ")).toBe(1200.5);
  });
  it("rejects zero, negative, non-numeric, empty", () => {
    expect(parseCreditLimit("0")).toBeNull();
    expect(parseCreditLimit("-5")).toBeNull();
    expect(parseCreditLimit("abc")).toBeNull();
    expect(parseCreditLimit("")).toBeNull();
  });
});

describe("parseBalance", () => {
  it("accepts positive, negative, and zero numbers", () => {
    expect(parseBalance("1200.50")).toBe(1200.5);
    expect(parseBalance("  -300 ")).toBe(-300);
    expect(parseBalance("0")).toBe(0);
  });
  it("treats blank as zero", () => {
    expect(parseBalance("")).toBe(0);
    expect(parseBalance("   ")).toBe(0);
  });
  it("rejects non-numeric input", () => {
    expect(parseBalance("abc")).toBeNull();
  });
});

describe("parseOutstanding", () => {
  it("accepts non-negative numbers", () => {
    expect(parseOutstanding("450")).toBe(450);
    expect(parseOutstanding("  1200.50 ")).toBe(1200.5);
    expect(parseOutstanding("0")).toBe(0);
  });
  it("treats blank as zero", () => {
    expect(parseOutstanding("")).toBe(0);
    expect(parseOutstanding("   ")).toBe(0);
  });
  it("rejects negative and non-numeric input", () => {
    expect(parseOutstanding("-5")).toBeNull();
    expect(parseOutstanding("abc")).toBeNull();
  });
});
