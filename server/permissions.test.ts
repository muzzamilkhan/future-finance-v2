import { describe, it, expect } from "vitest";
import { hasCapability, assertCan } from "./permissions";

const owner = { role: "OWNER", canEditItems: false, canEditOverrides: false, canEditHolidays: false, canUpdateBalance: false } as const;
const viewer = { role: "MEMBER", canEditItems: false, canEditOverrides: false, canEditHolidays: false, canUpdateBalance: false } as const;
const editor = { role: "MEMBER", canEditItems: true, canEditOverrides: false, canEditHolidays: false, canUpdateBalance: false } as const;

describe("hasCapability", () => {
  it("owner has every capability regardless of flags", () => {
    expect(hasCapability(owner, "editItems")).toBe(true);
    expect(hasCapability(owner, "updateBalance")).toBe(true);
  });
  it("member follows its flags", () => {
    expect(hasCapability(editor, "editItems")).toBe(true);
    expect(hasCapability(editor, "editOverrides")).toBe(false);
    expect(hasCapability(viewer, "editItems")).toBe(false);
  });
});

describe("assertCan", () => {
  it("throws FORBIDDEN when capability missing", () => {
    expect(() => assertCan(viewer, "editItems")).toThrow(/FORBIDDEN|forbidden/i);
  });
  it("does not throw when allowed", () => {
    expect(() => assertCan(editor, "editItems")).not.toThrow();
  });
});
