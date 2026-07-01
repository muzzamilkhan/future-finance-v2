import { describe, it, expect, vi } from "vitest";

// particular.ts imports ../trpc, which imports ./db (PrismaClient) and ./auth
// (next-auth, ESM-only at import time). Stub both so this pure-function test
// doesn't construct a real client or pull in next-auth — matches the pattern
// in server/trpc.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { assertOverrideAllowed, ownedAccountIds, assertReassignAllowed, buildListAllRows } from "./particular";

describe("assertOverrideAllowed", () => {
  it("rejects amount override on a fixed particular", () => {
    expect(() => assertOverrideAllowed(
      { isFixed: true, isCritical: false },
      { overriddenAmount: 50, overriddenDate: undefined, isSkipped: false },
    )).toThrow(/fixed/i);
  });
  it("rejects skip on a critical particular", () => {
    expect(() => assertOverrideAllowed(
      { isFixed: false, isCritical: true },
      { overriddenAmount: undefined, overriddenDate: undefined, isSkipped: true },
    )).toThrow(/critical/i);
  });
  it("allows a valid amount override on an adjustable particular", () => {
    expect(() => assertOverrideAllowed(
      { isFixed: false, isCritical: true },
      { overriddenAmount: 50, overriddenDate: undefined, isSkipped: false },
    )).not.toThrow();
  });
});

describe("ownedAccountIds", () => {
  it("returns the set of open account ids the user is a member of", async () => {
    const fakePrisma = {
      accountMembership: { findMany: vi.fn(async () => [{ accountId: "debit" }, { accountId: "credit" }]) },
    } as never;
    const set = await ownedAccountIds(fakePrisma, "u1");
    expect(set.has("debit")).toBe(true);
    expect(set.has("credit")).toBe(true);
    expect(set.has("other")).toBe(false);
  });
});

describe("assertReassignAllowed", () => {
  const owned = new Set(["debit", "credit"]);
  it("allows moving an expense to another owned account", () => {
    expect(() => assertReassignAllowed({ type: "EXPENSE" }, "debit", "credit", owned)).not.toThrow();
  });
  it("rejects reassigning a transfer", () => {
    expect(() => assertReassignAllowed({ type: "TRANSFER" }, "debit", "credit", owned)).toThrow(/Transfers cannot be reassigned/);
  });
  it("rejects moving to the same account", () => {
    expect(() => assertReassignAllowed({ type: "EXPENSE" }, "debit", "debit", owned)).toThrow(/Already on this account/);
  });
  it("rejects an unowned destination", () => {
    expect(() => assertReassignAllowed({ type: "EXPENSE" }, "debit", "savings", owned)).toThrow(/not found/);
  });
});

describe("buildListAllRows", () => {
  const meta = new Map([
    ["debit", { name: "Everyday", canEditItems: true }],
    ["credit", { name: "Visa", canEditItems: false }],
  ]);

  const base = {
    startDate: new Date("2026-01-01"), amount: 10, frequency: "MONTHLY" as const,
    isCritical: true, isFixed: true, businessDayAdjustment: "NONE" as const,
    category: null, overrides: [],
  };

  it("tags own-account rows as OUT with account meta", () => {
    const rows = buildListAllRows(
      [{ ...base, id: "p1", name: "Salary", type: "INCOME", accountId: "debit", toAccountId: null }],
      meta,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "p1", direction: "OUT", accountId: "debit", accountName: "Everyday", canEditItems: true,
    });
  });

  it("emits a single OUT row for a transfer between own accounts", () => {
    const rows = buildListAllRows(
      [{ ...base, id: "t1", name: "Pay card", type: "TRANSFER", accountId: "debit", toAccountId: "credit" }],
      meta,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.direction).toBe("OUT");
    expect(rows[0]!.accountId).toBe("debit");
    expect(rows[0]!.toAccountId).toBe("credit");
    expect(rows[0]!.canEditItems).toBe(true);
  });

  it("emits only the OUT row when the to-account is not one of the user's accounts", () => {
    const rows = buildListAllRows(
      [{ ...base, id: "t2", name: "Rent", type: "TRANSFER", accountId: "debit", toAccountId: "external" }],
      meta,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.direction).toBe("OUT");
  });
});
