import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { mapMembershipToListItem, creditAccountCreateData } from "./account";

describe("mapMembershipToListItem", () => {
  it("flattens membership + account into a list row", () => {
    const row = mapMembershipToListItem({
      role: "OWNER", isDefault: true,
      canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      account: { id: "a", name: "A", currentBalance: 12.5, balanceUpdatedAt: new Date(0), type: "DEBIT", creditLimit: null },
    } as any);
    expect(row).toMatchObject({ id: "a", name: "A", currentBalance: 12.5, role: "OWNER", isDefault: true, canEditItems: true });
  });
});

describe("creditAccountCreateData", () => {
  it("stores outstanding as a negative currentBalance and sets type CREDIT", () => {
    const data = creditAccountCreateData({ name: "Visa", creditLimit: 5000, outstanding: 450 });
    expect(data).toMatchObject({ name: "Visa", type: "CREDIT", creditLimit: 5000, currentBalance: -450 });
    expect(data.balanceUpdatedAt).toBeInstanceOf(Date);
  });
});

describe("mapMembershipToListItem credit fields", () => {
  it("surfaces type and creditLimit for a credit account", () => {
    const row = mapMembershipToListItem({
      role: "OWNER", isDefault: false,
      canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      account: { id: "c", name: "Visa", currentBalance: -450, balanceUpdatedAt: new Date(0), type: "CREDIT", creditLimit: 5000 },
    } as never);
    expect(row).toMatchObject({ id: "c", type: "CREDIT", creditLimit: 5000 });
  });
  it("reports null creditLimit for a debit account", () => {
    const row = mapMembershipToListItem({
      role: "OWNER", isDefault: true,
      canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      account: { id: "d", name: "A", currentBalance: 100, balanceUpdatedAt: new Date(0), type: "DEBIT", creditLimit: null },
    } as never);
    expect(row.creditLimit).toBeNull();
    expect(row.type).toBe("DEBIT");
  });
});
