import { describe, it, expect, vi } from "vitest";

// particular.ts imports ../trpc, which imports ./db (PrismaClient) and ./auth
// (next-auth, ESM-only at import time). Stub both so this pure-function test
// doesn't construct a real client or pull in next-auth — matches the pattern
// in server/trpc.test.ts.
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

import { assertOverrideAllowed } from "./particular";

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
