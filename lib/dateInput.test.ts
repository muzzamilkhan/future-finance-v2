import { describe, it, expect } from "vitest";
import {
  dateToInputValue,
  inputValueToDate,
  todayAsUtcDate,
  formatUtcWeekdayMonthDay,
  formatUtcMonthDayYear,
  formatUtcMonthDay,
  formatUtcWeekday,
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
    const d = todayAsUtcDate(now);
    expect(d.getUTCFullYear()).toBe(now.getFullYear());
    expect(d.getUTCMonth()).toBe(now.getMonth());
    expect(d.getUTCDate()).toBe(now.getDate());
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it("round-trips through the input helpers unchanged", () => {
    const d = todayAsUtcDate();
    expect(inputValueToDate(dateToInputValue(d))?.getTime()).toBe(d.getTime());
  });
});

describe("UTC display formatters", () => {
  // 2026-07-15 UTC is a Wednesday. These must render that calendar day regardless of
  // the runner's timezone — a local formatter would show the 14th west of UTC.
  const d = new Date(Date.UTC(2026, 6, 15));

  it("formatUtcWeekdayMonthDay -> 'Wed, Jul 15'", () => {
    expect(formatUtcWeekdayMonthDay(d)).toBe("Wed, Jul 15");
  });

  it("formatUtcMonthDayYear -> 'Jul 15, 2026'", () => {
    expect(formatUtcMonthDayYear(d)).toBe("Jul 15, 2026");
  });

  it("formatUtcMonthDay -> 'Jul 15'", () => {
    expect(formatUtcMonthDay(d)).toBe("Jul 15");
  });

  it("formatUtcWeekday -> 'Wed'", () => {
    expect(formatUtcWeekday(d)).toBe("Wed");
  });
});
