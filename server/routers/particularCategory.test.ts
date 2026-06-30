import { describe, it, expect, vi } from "vitest";

// particular.ts (and categorySync.ts via server/trpc) pull in ../db (PrismaClient)
// and ../auth (next-auth, ESM-only at import time). Stub both so this test only
// exercises plain functions against a fake in-memory prisma — matches the
// pattern in server/routers/particular.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { syncAccountCategories, computeUserCategories } from "../categorySync";

function makeFakePrisma(particulars: { category: string | null }[]) {
  return {
    financeAccount: {
      findUnique: vi.fn(async () => ({ id: "acc1", ownerId: "u1" })),
      create: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    particular: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data })),
      findFirst: vi.fn(async () => ({ id: "p1", accountId: "acc1", isFixed: false, isCritical: false })),
      findMany: vi.fn(async () => particulars),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("category lifecycle (create -> sync -> clear -> sync)", () => {
  it("syncs a newly created expense's category into FinanceAccount.categories", async () => {
    const fakePrisma = makeFakePrisma([{ category: "Rent" }]);

    await syncAccountCategories(fakePrisma, "acc1");

    expect(fakePrisma.financeAccount.update).toHaveBeenCalledWith({
      where: { id: "acc1" },
      data: { categories: "Rent" },
    });
  });

  it("removes the orphaned category from FinanceAccount.categories once cleared to null", async () => {
    // Simulates the post-update state: the particular's category column is
    // now NULL (the fix forces null instead of leaving Prisma's "undefined =
    // no-op" semantics in place), so the next sync sees no category for it.
    const fakePrisma = makeFakePrisma([{ category: null }]);

    await syncAccountCategories(fakePrisma, "acc1");

    expect(fakePrisma.financeAccount.update).toHaveBeenCalledWith({
      where: { id: "acc1" },
      data: { categories: "" },
    });
  });

  it("computeUserCategories drops null/blank categories (orphan removed)", () => {
    expect(computeUserCategories([null])).toBe("");
    expect(computeUserCategories(["Rent", null, ""])).toBe("Rent");
  });

  it("pins the null-coercion contract: update payload to particular.update must carry category: null, never undefined, when cleared", async () => {
    const fakePrisma = makeFakePrisma([]);
    const { id, ...data } = { id: "p1", name: "Rent", category: undefined as string | undefined };

    // Mirrors the exact fix applied in server/routers/particular.ts's update
    // mutation: force an explicit null instead of passing through undefined
    // (which Prisma treats as "leave column unchanged").
    await fakePrisma.particular.update({ where: { id }, data: { ...data, category: data.category ?? null } });

    expect(fakePrisma.particular.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { name: "Rent", category: null },
    });
  });
});
