import { describe, it, expect, vi } from "vitest";

// particular.ts imports ../trpc, which imports ./db (PrismaClient) and ./auth
// (next-auth, ESM-only at import time). Stub both so this pure-function test
// doesn't construct a real client or pull in next-auth — matches the pattern
// in server/trpc.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { assertOverrideAllowed, ownedAccountIds, assertReassignAllowed } from "./particular";

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
