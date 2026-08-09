import { describe, it, expect } from "vitest";
import {
  dateToInputValue,
  inputValueToDate,
  todayAsUtcDate,
  formatUtcFullDate,
  formatUtcWeekdayMonthDay,
  formatUtcMonthDayYear,
  formatUtcMonthDay,
  formatUtcWeekday,
  ordinal,
  formatUtcWeekdayLong,
} from "./dateInput";

// The engine reads every date via getUTCDate()/getUTCMonth()/getUTCFullYear()
// (see lib/engine/dates.ts), so a date the user picks must land on UTC midnight
// of that calendar day — otherwise, in a timezone east of UTC (e.g. NZ, UTC+12/13),
// the 15th gets stored as the 14th. These helpers must therefore be UTC-based, and
// crucially timezone-independent: the same input yields the same instant regardless
// of where the user runs.

describe("dateToInputValue", () => {
  it("formats a UTC-midnight Date as yyyy-MM-dd", () => {
    expect(dateToInputValue(new Date(Date.UTC(2026, 5, 28)))).toBe("2026-06-28");
  });

  it("zero-pads single-digit months and days", () => {
    expect(dateToInputValue(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01-05");
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
  it("parses yyyy-MM-dd into a UTC-midnight Date", () => {
    const d = inputValueToDate("2026-06-28");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCMonth()).toBe(5);
    expect(d?.getUTCDate()).toBe(28);
    expect(d?.getTime()).toBe(Date.UTC(2026, 5, 28));
  });

  it("preserves the picked day for the UTC-based engine (regression: 15th stayed the 15th)", () => {
    const d = inputValueToDate("2026-07-15");
    expect(d?.getUTCDate()).toBe(15);
    expect(d?.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("returns undefined for an empty string (optional end date)", () => {
    expect(inputValueToDate("")).toBeUndefined();
  });

  it("returns undefined for malformed input", () => {
    expect(inputValueToDate("not-a-date")).toBeUndefined();
  });

  it("round-trips with dateToInputValue", () => {
    const original = new Date(Date.UTC(2026, 11, 1));
    expect(dateToInputValue(inputValueToDate("2026-12-01"))).toBe("2026-12-01");
    expect(inputValueToDate(dateToInputValue(original))?.getTime()).toBe(original.getTime());
  });
});

describe("todayAsUtcDate", () => {
  it("anchors the local calendar day at UTC midnight", () => {
    // Late-evening NZ instant (UTC+13 in Jan): local day is the 15th even though
    // the UTC instant is still the 15th here — the point is the result is UTC midnight
    // of whatever local day `now` falls on, with no time-of-day component.
    const now = new Date("2026-01-15T22:30:00+13:00");
    const d = todayAsUtcDate("Australia/Sydney", now);
    expect(d.getUTCFullYear()).toBe(now.getFullYear());
    expect(d.getUTCMonth()).toBe(now.getMonth());
    expect(d.getUTCDate()).toBe(now.getDate());
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it("round-trips through the input helpers unchanged", () => {
    const d = todayAsUtcDate("Australia/Sydney");
    expect(inputValueToDate(dateToInputValue(d))?.getTime()).toBe(d.getTime());
  });

  it("returns UTC midnight of the calendar date in the given zone", () => {
    expect(todayAsUtcDate("Australia/Sydney", new Date("2026-08-09T20:00:00Z")))
      .toEqual(new Date(Date.UTC(2026, 7, 10)));
    expect(todayAsUtcDate("America/New_York", new Date("2026-08-09T02:00:00Z")))
      .toEqual(new Date(Date.UTC(2026, 7, 8)));
  });
});

describe("UTC display formatters", () => {
  // 2026-07-15 UTC is a Wednesday. These must render that calendar day regardless of
  // the runner's timezone — a local formatter would show the 14th west of UTC.
  const d = new Date(Date.UTC(2026, 6, 15));

  it("formatUtcWeekdayMonthDay -> 'Wed, Jul 15'", () => {
    expect(formatUtcWeekdayMonthDay(d, "en-US")).toBe("Wed, Jul 15");
  });

  it("formatUtcFullDate -> 'Wednesday, July 15, 2026'", () => {
    expect(formatUtcFullDate(d, "en-US")).toBe("Wednesday, July 15, 2026");
  });

  it("formatUtcFullDate -> 'Wednesday 15 July 2026' (en-AU)", () => {
    expect(formatUtcFullDate(d, "en-AU")).toBe("Wednesday 15 July 2026");
  });

  it("formatUtcMonthDayYear -> 'Jul 15, 2026'", () => {
    expect(formatUtcMonthDayYear(d, "en-US")).toBe("Jul 15, 2026");
  });

  it("formatUtcMonthDay -> 'Jul 15'", () => {
    expect(formatUtcMonthDay(d, "en-US")).toBe("Jul 15");
  });

  it("formatUtcWeekday -> 'Wed'", () => {
    expect(formatUtcWeekday(d)).toBe("Wed");
  });
});

describe("locale-aware formatting", () => {
  const d = new Date(Date.UTC(2026, 6, 15)); // Wed 15 July 2026

  // CLDR's en-AU day+month skeleton uses the FULL month name even at "short" width
  // (verified directly against Intl.DateTimeFormat in this runtime) — "15 July" is
  // correct output, not a bug. Don't "fix" this back to "15 Jul".
  it("uses day-month order for en-AU (the default)", () => {
    expect(formatUtcMonthDay(d)).toBe("15 July");
    expect(formatUtcMonthDayYear(d)).toBe("15 July 2026");
  });

  it("uses month-day order for en-US", () => {
    expect(formatUtcMonthDay(d, "en-US")).toBe("Jul 15");
    expect(formatUtcMonthDayYear(d, "en-US")).toBe("Jul 15, 2026");
  });

  it("keeps weekday names locale-stable for English locales", () => {
    expect(formatUtcWeekday(d, "en-US")).toBe("Wed");
    expect(formatUtcWeekdayLong(d, "en-AU")).toBe("Wednesday");
  });

  it("still formats in UTC regardless of locale", () => {
    // 23:30 UTC on the 15th is the 16th in Sydney, but these render the UTC day.
    // (en-AU renders the full month name at "short" width — see note above; that's
    // orthogonal to the UTC-day point this test is making.)
    const late = new Date(Date.UTC(2026, 6, 15, 23, 30));
    expect(formatUtcMonthDay(late, "en-AU")).toBe("15 July");
  });
});

describe("ordinal", () => {
  it("handles the common ones/twos/threes", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
  });
  it("handles the teens as th", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(14)).toBe("14th");
  });
  it("handles the twenties", () => {
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(23)).toBe("23rd");
    expect(ordinal(26)).toBe("26th");
  });
});

describe("formatUtcWeekdayLong", () => {
  it("returns the full UTC weekday name", () => {
    // 2026-08-26 is a Wednesday
    expect(formatUtcWeekdayLong(new Date(Date.UTC(2026, 7, 26)))).toBe("Wednesday");
    // 2026-07-06 is a Monday
    expect(formatUtcWeekdayLong(new Date(Date.UTC(2026, 6, 6)))).toBe("Monday");
  });
});
