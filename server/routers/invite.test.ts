import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ prisma: {} }));
vi.mock("../auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
import { permsFromInvite } from "./invite";

describe("permsFromInvite", () => {
  it("copies role + perm flags from invite to membership data", () => {
    const data = permsFromInvite({
      role: "MEMBER", canEditItems: true, canEditOverrides: false, canUpdateBalance: false,
    } as any);
    expect(data).toEqual({
      role: "MEMBER", canEditItems: true, canEditOverrides: false, canUpdateBalance: false,
    });
  });
});
