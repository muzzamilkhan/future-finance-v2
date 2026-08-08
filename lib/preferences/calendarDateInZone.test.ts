import { describe, it, expect } from "vitest";
import { calendarDateInZone } from "./calendarDateInZone";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("calendarDateInZone", () => {
  it("returns UTC midnight of the local calendar date", () => {
    // 2026-08-09 04:00 UTC is 2026-08-09 14:00 in Sydney (UTC+10).
    expect(calendarDateInZone(new Date("2026-08-09T04:00:00Z"), "Australia/Sydney"))
      .toEqual(utc(2026, 8, 9));
  });

  it("is a day AHEAD of UTC for a positive-offset zone late in the UTC day", () => {
    // 2026-08-09 20:00 UTC is already 2026-08-10 06:00 in Sydney.
    expect(calendarDateInZone(new Date("2026-08-09T20:00:00Z"), "Australia/Sydney"))
      .toEqual(utc(2026, 8, 10));
  });

  it("is a day BEHIND UTC for a negative-offset zone early in the UTC day", () => {
    // 2026-08-09 02:00 UTC is still 2026-08-08 22:00 in New York (UTC-4).
    expect(calendarDateInZone(new Date("2026-08-09T02:00:00Z"), "America/New_York"))
      .toEqual(utc(2026, 8, 8));
  });

  it("handles the Sydney DST start (AEST->AEDT, first Sunday of October)", () => {
    // 2026-10-04 02:00 local: clocks jump 2am -> 3am. 15:30 UTC on 10-03 is
    // 2026-10-04 02:30 AEDT, i.e. already the 4th locally.
    expect(calendarDateInZone(new Date("2026-10-03T15:30:00Z"), "Australia/Sydney"))
      .toEqual(utc(2026, 10, 4));
  });

  it("handles the Sydney DST end (AEDT->AEST, first Sunday of April)", () => {
    // 2026-04-05 13:00 UTC is 2026-04-05 23:00 AEST (offset back to +10).
    expect(calendarDateInZone(new Date("2026-04-05T13:00:00Z"), "Australia/Sydney"))
      .toEqual(utc(2026, 4, 5));
  });

  it("returns a UTC-midnight instant (no time component)", () => {
    const d = calendarDateInZone(new Date("2026-08-09T13:45:12Z"), "Australia/Sydney");
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  it("falls back to the default zone when given an invalid zone", () => {
    expect(calendarDateInZone(new Date("2026-08-09T04:00:00Z"), "Not/AZone"))
      .toEqual(utc(2026, 8, 9));
  });
});
