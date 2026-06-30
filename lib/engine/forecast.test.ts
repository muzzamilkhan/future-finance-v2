import { describe, it, expect } from "vitest";
import { computeForecast } from "./forecast";
import type { EngineParticular, ForecastInput } from "./types";

const d = (s: string) => new Date(s + "T00:00:00");

const expense = (id: string, day: string, amt: number): EngineParticular => ({
  id, name: id, type: "EXPENSE", amount: amt, frequency: "ONCE_OFF",
  startDate: d(day), endDate: null, isCritical: true, isFixed: true,
  businessDayAdjustment: "NONE", overrides: [],
});

const baseInput = (over: Partial<ForecastInput>): ForecastInput => ({
  anchorBalance: 1000, anchorDate: d("2026-07-01"),
  viewStart: d("2026-07-01"), viewEnd: d("2026-07-05"),
  today: d("2026-07-01"), skipToday: false,
  particulars: [], holidays: [], ...over,
});

describe("computeForecast", () => {
  it("seeds the first opening balance with anchorBalance", () => {
    const r = computeForecast(baseInput({}));
    expect(r.days[0]!.openingBalance).toBe(1000);
  });

  it("applies an expense to the closing balance", () => {
    const r = computeForecast(baseInput({ particulars: [expense("rent", "2026-07-02", 200)] }));
    const jul2 = r.days.find(x => x.date.getDate() === 2)!;
    expect(jul2.closingBalance).toBe(800);
  });

  it("anchors future-window balances to events BEFORE viewStart", () => {
    // anchorDate Jul 1, but we only DISPLAY Jul 4-5; an expense on Jul 2 must still count
    const r = computeForecast(baseInput({
      viewStart: d("2026-07-04"), viewEnd: d("2026-07-05"),
      particulars: [expense("rent", "2026-07-02", 200)],
    }));
    expect(r.days[0]!.date.getDate()).toBe(4);      // display starts Jul 4
    expect(r.days[0]!.openingBalance).toBe(800);     // but reflects the Jul 2 expense
  });

  it("flags a negative day and reports firstNegative", () => {
    const r = computeForecast(baseInput({ particulars: [expense("big", "2026-07-02", 5000)] }));
    expect(r.firstNegative).not.toBeNull();
    expect(r.firstNegative!.date.getDate()).toBe(2);
  });

  it("reports the lowest balance day", () => {
    const r = computeForecast(baseInput({
      particulars: [expense("a", "2026-07-02", 300), expense("b", "2026-07-03", 100)],
    }));
    expect(r.lowest!.date.getDate()).toBe(3);
    expect(r.lowest!.closingBalance).toBe(600);
  });

  it("reports the highest balance day", () => {
    const income = (id: string, day: string, amt: number): EngineParticular => ({
      id, name: id, type: "INCOME", amount: amt, frequency: "ONCE_OFF",
      startDate: d(day), endDate: null, isCritical: true, isFixed: true,
      businessDayAdjustment: "NONE", overrides: [],
    });
    const r = computeForecast(baseInput({
      particulars: [income("a", "2026-07-02", 300), income("b", "2026-07-03", 100)],
    }));
    // Jul 2 closes at 1300, Jul 3 at 1400 — Jul 3 is highest
    expect(r.highest!.date.getDate()).toBe(3);
    expect(r.highest!.closingBalance).toBe(1400);
  });

  it("marks events overridable unless fixed AND critical", () => {
    const locked = expense("locked", "2026-07-02", 100); // isFixed + isCritical
    const flexible: EngineParticular = { ...locked, id: "flex", name: "flex", isFixed: false };
    const r = computeForecast(baseInput({ particulars: [locked, flexible] }));
    const jul2 = r.days.find((x) => x.date.getDate() === 2)!;
    const lockedEv = jul2.events.find((e) => e.particularId === "locked")!;
    const flexEv = jul2.events.find((e) => e.particularId === "flex")!;
    expect(lockedEv.isOverridable).toBe(false);
    expect(flexEv.isOverridable).toBe(true);
  });

  it("surfaces overrideId on overridden events and leaves it undefined otherwise", () => {
    const flexible: EngineParticular = {
      ...expense("flex", "2026-07-02", 100), isFixed: false,
      overrides: [{ id: "ov-1", originalDate: d("2026-07-02"), overriddenDate: null, overriddenAmount: 250, isSkipped: false }],
    };
    const plain = expense("plain", "2026-07-03", 100);
    const r = computeForecast(baseInput({ particulars: [flexible, plain] }));
    const flexEv = r.days.find((x) => x.date.getDate() === 2)!.events.find((e) => e.particularId === "flex")!;
    const plainEv = r.days.find((x) => x.date.getDate() === 3)!.events.find((e) => e.particularId === "plain")!;
    expect(flexEv.isOverridden).toBe(true);
    expect(flexEv.overrideId).toBe("ov-1");
    expect(plainEv.overrideId).toBeUndefined();
  });

  it("skipToday drops today's events", () => {
    const r = computeForecast(baseInput({
      today: d("2026-07-02"), skipToday: true,
      particulars: [expense("rent", "2026-07-02", 200)],
    }));
    const jul2 = r.days.find(x => x.date.getDate() === 2)!;
    expect(jul2.events).toHaveLength(0);
    expect(jul2.closingBalance).toBe(1000);
  });

  it("produces a monthly summary with net change", () => {
    const r = computeForecast(baseInput({
      viewStart: d("2026-07-01"), viewEnd: d("2026-07-31"),
      particulars: [expense("rent", "2026-07-02", 200)],
    }));
    expect(r.months).toHaveLength(1);
    expect(r.months[0]!.totalExpenses).toBe(-200);
    expect(r.months[0]!.netChange).toBe(-200);
  });
});
