import { describe, it, expect, vi } from "vitest";

// debt.ts imports ../trpc, which imports ./db (PrismaClient) and ./auth
// (next-auth, ESM-only). Stub both so this pure-function test doesn't
// construct a real client — matches server/routers/particular.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { assertReorderIds, debtRouter } from "./debt";

// ---------------------------------------------------------------------------
// Helpers for procedure-level tests
// ---------------------------------------------------------------------------

/** Build a fake ctx scoped to the given userId. */
function makeCtx(userId: string, prismaDebt: Record<string, unknown> = {}) {
  return {
    user: { id: userId },
    prisma: { debt: prismaDebt } as never,
    // Debts hang off the User, not a FinanceAccount, so no debt procedure should
    // ever reach for the account memberships. Throw rather than stub it out, so a
    // future change that does reach for them fails loudly here.
    openMemberships: () => { throw new Error("debt procedures must not load memberships"); },
  };
}

const validDebt = { name: "Card", balance: 1000, apr: 0.2, minPayment: 25 };

describe("assertReorderIds", () => {
  it("allows a permutation of exactly the current ids", () => {
    expect(() => assertReorderIds(["a", "b", "c"], ["c", "a", "b"])).not.toThrow();
  });
  it("rejects a missing id", () => {
    expect(() => assertReorderIds(["a", "b", "c"], ["a", "b"])).toThrow(/reorder/i);
  });
  it("rejects an unknown id", () => {
    expect(() => assertReorderIds(["a", "b"], ["a", "b", "x"])).toThrow(/reorder/i);
  });
  it("rejects a duplicate id", () => {
    expect(() => assertReorderIds(["a", "b"], ["a", "a"])).toThrow(/reorder/i);
  });
});

// ---------------------------------------------------------------------------
// Procedure-level tests — user-scoping and sortOrder assignment
// ---------------------------------------------------------------------------

describe("debt.list — user scoping", () => {
  it("calls findMany with where userId = ctx.user.id and orderBy sortOrder asc", async () => {
    const findMany = vi.fn(async (_args: { where: unknown; orderBy: unknown }) => []);
    const caller = debtRouter.createCaller(makeCtx("user-1", { findMany }));
    await caller.list();
    expect(findMany).toHaveBeenCalledOnce();
    const [args] = findMany.mock.calls[0]!;
    expect(args.where).toMatchObject({ userId: "user-1" });
    expect(args.orderBy).toMatchObject({ sortOrder: "asc" });
  });
});

describe("debt.create — user scoping and sortOrder", () => {
  it("assigns userId = ctx.user.id (ignores any client-supplied userId)", async () => {
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "d1", ...args.data }));
    const aggregate = vi.fn(async () => ({ _max: { sortOrder: null } }));
    const caller = debtRouter.createCaller(makeCtx("user-42", { aggregate, create }));
    await caller.create(validDebt);
    const [args] = create.mock.calls[0]!;
    expect(args.data.userId).toBe("user-42");
  });

  it("sets sortOrder = 0 when no existing debts (max is null)", async () => {
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "d1", ...args.data }));
    const aggregate = vi.fn(async () => ({ _max: { sortOrder: null } }));
    const caller = debtRouter.createCaller(makeCtx("user-42", { aggregate, create }));
    await caller.create(validDebt);
    const [args] = create.mock.calls[0]!;
    expect(args.data.sortOrder).toBe(0); // (-1 + 1)
  });

  it("sets sortOrder = max+1 when debts already exist", async () => {
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "d2", ...args.data }));
    const aggregate = vi.fn(async () => ({ _max: { sortOrder: 3 } }));
    const caller = debtRouter.createCaller(makeCtx("user-42", { aggregate, create }));
    await caller.create(validDebt);
    const [args] = create.mock.calls[0]!;
    expect(args.data.sortOrder).toBe(4);
  });

  it("scopes aggregate to userId so it only counts the caller's debts", async () => {
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "d3", ...args.data }));
    const aggregate = vi.fn(async (_args: { where: unknown; _max: unknown }) => ({ _max: { sortOrder: 0 } }));
    const caller = debtRouter.createCaller(makeCtx("user-7", { aggregate, create }));
    await caller.create(validDebt);
    const [aggArgs] = aggregate.mock.calls[0]!;
    expect(aggArgs.where).toMatchObject({ userId: "user-7" });
  });
});

describe("debt.update — user scoping", () => {
  it("throws NOT_FOUND when findFirst returns null (another user's debt)", async () => {
    const findFirst = vi.fn(async () => null);
    const caller = debtRouter.createCaller(makeCtx("user-1", { findFirst }));
    await expect(caller.update({ id: "other-debt", ...validDebt })).rejects.toThrow(/NOT_FOUND/i);
  });

  it("scopes findFirst by both id and userId", async () => {
    const fakeDebt = { id: "d1", userId: "user-1", ...validDebt, sortOrder: 0 };
    const findFirst = vi.fn(async (_args: { where: unknown }) => fakeDebt);
    const update = vi.fn(async () => fakeDebt);
    const caller = debtRouter.createCaller(makeCtx("user-1", { findFirst, update }));
    await caller.update({ id: "d1", ...validDebt });
    const [args] = findFirst.mock.calls[0]!;
    expect(args.where).toMatchObject({ id: "d1", userId: "user-1" });
  });
});

describe("debt.delete — user scoping", () => {
  it("calls deleteMany with where { id, userId } scoped to the caller", async () => {
    const deleteMany = vi.fn(async (_args: { where: unknown }) => ({ count: 1 }));
    const caller = debtRouter.createCaller(makeCtx("user-9", { deleteMany }));
    await caller.delete({ id: "debt-x" });
    expect(deleteMany).toHaveBeenCalledOnce();
    const [args] = deleteMany.mock.calls[0]!;
    expect(args.where).toMatchObject({ id: "debt-x", userId: "user-9" });
  });
});
