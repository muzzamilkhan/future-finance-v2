import { describe, it, expect, vi } from "vitest";

// forecast.ts imports ../trpc -> ../db (PrismaClient) and ../auth (next-auth, ESM-only).
// Stub both so this test exercises only the pure helpers — matches the pattern
// in server/routers/particular.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { combinedWindowStart, toAccountPayload } from "./forecast";

const d = (s: string) => new Date(s + "T00:00:00Z");

describe("combinedWindowStart", () => {
  it("clamps to the earliest account anchor when it predates viewStart", () => {
    const accounts = [{ balanceUpdatedAt: d("2026-05-01") }, { balanceUpdatedAt: d("2026-06-15") }];
    expect(combinedWindowStart(accounts, d("2026-06-01")).getTime()).toBe(d("2026-05-01").getTime());
  });
  it("uses viewStart when all anchors are on/after it", () => {
    const accounts = [{ balanceUpdatedAt: d("2026-06-10") }];
    expect(combinedWindowStart(accounts, d("2026-06-01")).getTime()).toBe(d("2026-06-01").getTime());
  });
  it("returns viewStart for no accounts", () => {
    expect(combinedWindowStart([], d("2026-06-01")).getTime()).toBe(d("2026-06-01").getTime());
  });
});

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
