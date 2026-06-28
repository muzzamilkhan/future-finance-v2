import { describe, it, expect } from "vitest";
import { isBusinessDay, adjustToBusinessDay, expandRecurringHolidays } from "./dates";
import type { EngineHoliday } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");

describe("isBusinessDay", () => {
  it("returns false on a Saturday", () => {
    expect(isBusinessDay(d("2026-06-27"), [])).toBe(false); // Sat
  });
  it("returns false on a Sunday", () => {
    expect(isBusinessDay(d("2026-06-28"), [])).toBe(false); // Sun
  });
  it("returns true on a weekday with no holiday", () => {
    expect(isBusinessDay(d("2026-06-29"), [])).toBe(true); // Mon
  });
  it("returns false on a one-time holiday", () => {
    const h: EngineHoliday[] = [{ date: d("2026-06-29"), isRecurring: false }];
    expect(isBusinessDay(d("2026-06-29"), h)).toBe(false);
  });
  it("returns false on a recurring holiday (month+day, any year)", () => {
    const h: EngineHoliday[] = [{ date: d("2000-12-25"), isRecurring: true }];
    expect(isBusinessDay(d("2026-12-25"), h)).toBe(false);
  });
});

describe("adjustToBusinessDay", () => {
  it("NONE leaves the date unchanged", () => {
    expect(adjustToBusinessDay(d("2026-06-27"), "NONE", []).getTime())
      .toBe(d("2026-06-27").getTime());
  });
  it("NEXT_BUSINESS_DAY moves Saturday to Monday", () => {
    expect(adjustToBusinessDay(d("2026-06-27"), "NEXT_BUSINESS_DAY", []).getTime())
      .toBe(d("2026-06-29").getTime());
  });
  it("PREVIOUS_BUSINESS_DAY moves Sunday to Friday", () => {
    expect(adjustToBusinessDay(d("2026-06-28"), "PREVIOUS_BUSINESS_DAY", []).getTime())
      .toBe(d("2026-06-26").getTime());
  });
  it("skips over a holiday adjacent to the weekend", () => {
    const h: EngineHoliday[] = [{ date: d("2026-06-29"), isRecurring: false }];
    // Sat -> Mon is holiday -> Tue
    expect(adjustToBusinessDay(d("2026-06-27"), "NEXT_BUSINESS_DAY", h).getTime())
      .toBe(d("2026-06-30").getTime());
  });
});

describe("expandRecurringHolidays", () => {
  it("expands a recurring holiday to one instance per year within [start, end]", () => {
    const h: EngineHoliday[] = [{ date: d("2000-12-25"), isRecurring: true }];
    const result = expandRecurringHolidays(h, d("2025-01-01"), d("2027-12-31"));
    expect(result).toHaveLength(3);
    expect(result.map((dt) => dt.getFullYear())).toEqual([2025, 2026, 2027]);
    for (const dt of result) {
      expect(dt.getMonth()).toBe(11); // December
      expect(dt.getDate()).toBe(25);
    }
    expect(result[0]!.getTime()).toBe(d("2025-12-25").getTime());
    expect(result[1]!.getTime()).toBe(d("2026-12-25").getTime());
    expect(result[2]!.getTime()).toBe(d("2027-12-25").getTime());
  });

  it("includes a one-time holiday inside the range", () => {
    const h: EngineHoliday[] = [{ date: d("2026-03-15"), isRecurring: false }];
    const result = expandRecurringHolidays(h, d("2026-01-01"), d("2026-12-31"));
    expect(result).toHaveLength(1);
    expect(result[0]!.getTime()).toBe(d("2026-03-15").getTime());
  });

  it("excludes a one-time holiday outside the range", () => {
    const h: EngineHoliday[] = [{ date: d("2024-03-15"), isRecurring: false }];
    const result = expandRecurringHolidays(h, d("2026-01-01"), d("2026-12-31"));
    expect(result).toEqual([]);
  });

  it("excludes a recurring holiday whose month+day falls outside the window for the only year in range", () => {
    const h: EngineHoliday[] = [{ date: d("2000-12-25"), isRecurring: true }];
    const result = expandRecurringHolidays(h, d("2026-01-01"), d("2026-06-30"));
    expect(result).toEqual([]);
  });
});
