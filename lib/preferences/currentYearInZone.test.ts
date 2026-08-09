import { describe, it, expect } from "vitest";
import { currentYearInZone } from "./currentYearInZone";

describe("currentYearInZone", () => {
  it("returns the year in the given zone", () => {
    expect(currentYearInZone(new Date("2026-08-09T04:00:00Z"), "Australia/Sydney")).toBe(2026);
  });

  // The whole reason this helper exists: on New Year's Eve UTC, Sydney is already in
  // the next year. Using the server clock here would import the wrong year's holidays.
  it("is a year AHEAD of UTC for a positive-offset zone on New Year's Eve", () => {
    const nye = new Date("2026-12-31T14:00:00Z"); // 2027-01-01 01:00 AEDT
    expect(nye.getUTCFullYear()).toBe(2026);
    expect(currentYearInZone(nye, "Australia/Sydney")).toBe(2027);
  });

  it("is a year BEHIND UTC for a negative-offset zone on New Year's Day", () => {
    const nyd = new Date("2027-01-01T03:00:00Z"); // 2026-12-31 22:00 EST
    expect(nyd.getUTCFullYear()).toBe(2027);
    expect(currentYearInZone(nyd, "America/New_York")).toBe(2026);
  });

  it("falls back to the default zone for an invalid zone", () => {
    expect(currentYearInZone(new Date("2026-08-09T04:00:00Z"), "Not/AZone")).toBe(2026);
  });
});
