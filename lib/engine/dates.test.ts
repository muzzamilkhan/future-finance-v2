import { describe, it, expect } from "vitest";
import { isBusinessDay, adjustToBusinessDay } from "./dates";
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
