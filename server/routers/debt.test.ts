import { describe, it, expect, vi } from "vitest";

// debt.ts imports ../trpc, which imports ./db (PrismaClient) and ./auth
// (next-auth, ESM-only). Stub both so this pure-function test doesn't
// construct a real client — matches server/routers/particular.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { assertReorderIds } from "./debt";

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
