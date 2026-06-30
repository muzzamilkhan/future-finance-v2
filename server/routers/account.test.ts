import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { mapMembershipToListItem } from "./account";

describe("mapMembershipToListItem", () => {
  it("flattens membership + account into a list row", () => {
    const row = mapMembershipToListItem({
      role: "OWNER", isDefault: true,
      canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      account: { id: "a", name: "A", currentBalance: 12.5, balanceUpdatedAt: new Date(0) },
    } as any);
    expect(row).toMatchObject({ id: "a", name: "A", currentBalance: 12.5, role: "OWNER", isDefault: true, canEditItems: true });
  });
});
