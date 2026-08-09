import { describe, it, expect } from "vitest";
import { frequencyLabel } from "./frequencyLabel";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

describe("frequencyLabel", () => {
  it("labels MONTHLY by ordinal day", () => {
    expect(frequencyLabel({ frequency: "MONTHLY", startDate: d(2026, 1, 14) }, d(2026, 7, 1)))
      .toBe("Every 14th");
  });

  it("labels WEEKLY by full weekday", () => {
    // 2026-07-06 is a Monday
    expect(frequencyLabel({ frequency: "WEEKLY", startDate: d(2026, 7, 6) }, d(2026, 7, 1)))
      .toBe("Every Monday");
  });

  it("labels ANNUAL as Every <day> <month>", () => {
    expect(frequencyLabel({ frequency: "ANNUAL", startDate: d(2025, 8, 26) }, d(2026, 7, 1)))
      .toBe("Every 26th Aug");
  });

  it("labels ONCE_OFF as <day> <month>, <year>", () => {
    expect(frequencyLabel({ frequency: "ONCE_OFF", startDate: d(2026, 8, 26) }, d(2026, 7, 1)))
      .toBe("26th Aug, 2026");
  });

  describe("FORTNIGHTLY (Mon-Sun weeks)", () => {
    // Start Tue 2026-06-30. Occurrences: 06-30, 07-14, 07-28, ...
    const start = d(2026, 6, 30);

    it("says This <weekday> when the next occurrence is in today's Mon-Sun week", () => {
      // today Mon 2026-06-29 -> same Mon-Sun week (06-29..07-05) as occurrence 06-30
      expect(frequencyLabel({ frequency: "FORTNIGHTLY", startDate: start }, d(2026, 6, 29)))
        .toBe("This Tue");
    });

    it("says Next <weekday> when the next occurrence is in the following week", () => {
      // today Mon 2026-07-06 -> next occurrence 07-14 is in week 07-13..07-19 (following week)
      expect(frequencyLabel({ frequency: "FORTNIGHTLY", startDate: start }, d(2026, 7, 6)))
        .toBe("Next Tue");
    });

    it("falls back to Every other <weekday> when the next hit is 2+ weeks out", () => {
      // today Mon 2026-06-15 -> next occurrence 06-30 is two weeks out (weeks: cur 06-15, next 06-22, then 06-29)
      expect(frequencyLabel({ frequency: "FORTNIGHTLY", startDate: start }, d(2026, 6, 15)))
        .toBe("Every other Tue");
    });

    it("assigns a Sunday occurrence to the Mon-Sun week that began the prior Monday", () => {
      // Start Sun 2026-07-05; its Mon-Sun week is Mon 06-29..Sun 07-05.
      // today Mon 2026-06-29 is in that same week -> "This Sun" (exercises dow=0 -> daysSinceMonday=6).
      expect(frequencyLabel({ frequency: "FORTNIGHTLY", startDate: d(2026, 7, 5) }, d(2026, 6, 29)))
        .toBe("This Sun");
    });
  });

  describe("locale", () => {
    it("defaults to en-AU weekday names", () => {
      expect(frequencyLabel({ frequency: "WEEKLY", startDate: d(2026, 7, 6) }, d(2026, 7, 1)))
        .toBe("Every Monday");
    });

    it("accepts an explicit locale", () => {
      expect(frequencyLabel({ frequency: "WEEKLY", startDate: d(2026, 7, 6) }, d(2026, 7, 1), "en-US"))
        .toBe("Every Monday");
    });
  });
});
