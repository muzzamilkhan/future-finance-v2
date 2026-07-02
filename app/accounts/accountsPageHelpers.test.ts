import { describe, it, expect } from "vitest";
import { groupAccounts, parseCreditLimit } from "./accountsPageHelpers";
import type { AccountListItem } from "@/app/_components/AccountContext";

const base: Omit<AccountListItem, "id" | "role"> = {
  name: "A", currentBalance: 0, balanceUpdatedAt: new Date(0),
  type: "DEBIT", creditLimit: null, isDefault: false,
  canEditItems: false, canEditOverrides: false, canEditHolidays: false, canUpdateBalance: false,
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
