import { describe, it, expect, vi } from "vitest";

vi.mock("./db", () => ({
  prisma: {
    financeAccount: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "acc1", ownerId: "u1", currentBalance: 0 }),
    },
  },
}));
// auth.ts pulls in next-auth (ESM-only at import time); stub it for the unit test.
vi.mock("./auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { resolveAccount } from "./trpc";

describe("resolveAccount", () => {
  it("auto-creates an account when the user has none", async () => {
    const acc = await resolveAccount("u1");
    expect(acc.id).toBe("acc1");
  });
});
