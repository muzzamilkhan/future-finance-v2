import { describe, it, expect, vi } from "vitest";
import { syncAccountCategories, computeUserCategories } from "./categorySync";

describe("computeUserCategories", () => {
  it("serializes distinct non-null expense categories, sorted", () => {
    expect(computeUserCategories(["Rent", "Groceries", "Rent", null])).toBe("Groceries,Rent");
  });
  it("drops nulls and blanks; returns empty string when none", () => {
    expect(computeUserCategories([null, "", "  "])).toBe("");
    expect(computeUserCategories([])).toBe("");
  });
});

describe("syncAccountCategories", () => {
  it("writes serialized expense categories to the account", async () => {
    const update = vi.fn();
    const prisma = {
      particular: { findMany: vi.fn().mockResolvedValue([{ category: "Food" }, { category: "Rent" }, { category: null }]) },
      financeAccount: { update },
    } as any;
    await syncAccountCategories(prisma, "acc1");
    expect(prisma.particular.findMany).toHaveBeenCalledWith({
      where: { accountId: "acc1", type: "EXPENSE" }, select: { category: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "acc1" }, data: { categories: computeUserCategories(["Food", "Rent", null]) },
    });
  });
});
