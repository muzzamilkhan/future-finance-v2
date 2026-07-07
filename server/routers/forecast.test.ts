import { describe, it, expect, vi } from "vitest";

// forecast.ts imports ../trpc -> ../db (PrismaClient) and ../auth (next-auth, ESM-only).
// Stub both so this test exercises only the pure helpers — matches the pattern
// in server/routers/particular.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { toAccountPayload, ownerUserIds } from "./forecast";

const d = (s: string) => new Date(s + "T00:00:00Z");

describe("toAccountPayload", () => {
  it("coerces Decimal-like balances to numbers and keeps null creditLimit for debit", () => {
    const out = toAccountPayload({
      id: "d", name: "My Account", type: "DEBIT",
      currentBalance: { toString: () => "1000.00" } as unknown as number,
      balanceUpdatedAt: d("2026-06-01"), creditLimit: null,
    });
    expect(out).toMatchObject({ id: "d", type: "DEBIT", currentBalance: 1000, creditLimit: null });
  });
  it("coerces a credit account's negative outstanding and limit", () => {
    const out = toAccountPayload({
      id: "c", name: "Visa", type: "CREDIT",
      currentBalance: { toString: () => "-200.00" } as unknown as number,
      balanceUpdatedAt: d("2026-06-01"), creditLimit: { toString: () => "1000.00" } as unknown as number,
    });
    expect(out).toMatchObject({ id: "c", type: "CREDIT", currentBalance: -200, creditLimit: 1000 });
  });
});

describe("ownerUserIds", () => {
  it("returns distinct owner userIds across accounts", () => {
    const rows = [
      { accountId: "a1", userId: "u1", role: "OWNER" as const },
      { accountId: "a1", userId: "u2", role: "MEMBER" as const },
      { accountId: "a2", userId: "u3", role: "OWNER" as const },
      { accountId: "a3", userId: "u1", role: "OWNER" as const }, // u1 owns two accounts
    ];
    expect(ownerUserIds(rows).sort()).toEqual(["u1", "u3"]);
  });

  it("ignores non-owner rows", () => {
    const rows = [{ accountId: "a1", userId: "m", role: "MEMBER" as const }];
    expect(ownerUserIds(rows)).toEqual([]);
  });
});
