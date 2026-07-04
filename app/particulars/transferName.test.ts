import { describe, it, expect } from "vitest";
import { transferName } from "./transferName";

describe("transferName", () => {
  it("derives a name from the destination account", () => {
    expect(transferName("Savings")).toBe("Transfer to Savings");
  });

  it("trims surrounding whitespace on the destination name", () => {
    expect(transferName("  Savings  ")).toBe("Transfer to Savings");
  });

  it("falls back to a generic name when the destination is unknown", () => {
    expect(transferName("")).toBe("Transfer");
    expect(transferName(undefined)).toBe("Transfer");
  });
});
