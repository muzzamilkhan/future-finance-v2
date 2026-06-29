import { describe, it, expect } from "vitest";
import { dateToInputValue, inputValueToDate } from "./dateInput";

describe("dateToInputValue", () => {
  it("formats a Date as yyyy-MM-dd in local time", () => {
    expect(dateToInputValue(new Date(2026, 5, 28))).toBe("2026-06-28");
  });

  it("zero-pads single-digit months and days", () => {
    expect(dateToInputValue(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("returns empty string for null/undefined (no end date)", () => {
    expect(dateToInputValue(null)).toBe("");
    expect(dateToInputValue(undefined)).toBe("");
  });

  it("returns empty string for an invalid Date", () => {
    expect(dateToInputValue(new Date("nonsense"))).toBe("");
  });
});

describe("inputValueToDate", () => {
  it("parses yyyy-MM-dd into a local Date", () => {
    const d = inputValueToDate("2026-06-28");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(28);
  });

  it("returns undefined for an empty string (optional end date)", () => {
    expect(inputValueToDate("")).toBeUndefined();
  });

  it("round-trips with dateToInputValue", () => {
    const original = new Date(2026, 11, 1);
    expect(dateToInputValue(inputValueToDate("2026-12-01"))).toBe("2026-12-01");
    expect(inputValueToDate(dateToInputValue(original))?.getTime()).toBe(original.getTime());
  });
});
