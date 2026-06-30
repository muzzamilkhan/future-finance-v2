import { describe, it, expect, vi } from "vitest";

const account = { id: "acc1", name: "A", currentBalance: 0, closedAt: null };
const membership = { id: "m1", userId: "u1", accountId: "acc1", role: "OWNER" };

vi.mock("./db", () => ({
  prisma: {
    accountMembership: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.userId_accountId.accountId === "acc1" && where.userId_accountId.userId === "u1"
          ? { ...membership, account } : null),
      count: vi.fn(async () => 1),
    },
  },
}));
vi.mock("./auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { resolveMembership } from "./trpc";

describe("resolveMembership", () => {
  it("returns account + membership for a member", async () => {
    const r = await resolveMembership("u1", "acc1");
    expect(r.account.id).toBe("acc1");
    expect(r.membership.role).toBe("OWNER");
  });
  it("throws FORBIDDEN for a non-member", async () => {
    await expect(resolveMembership("u1", "other")).rejects.toThrow(/FORBIDDEN/);
  });
});
