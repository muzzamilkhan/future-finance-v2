import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateInstances } from "./instances";
import type { EngineParticular } from "./types";

const d = (s: string) => new Date(s + "T00:00:00Z");
const base: EngineParticular = {
  id: "p1", name: "Test", type: "EXPENSE", amount: 100,
  accountId: "debit", toAccountId: null,
  frequency: "ONCE_OFF", startDate: d("2026-07-10"), endDate: null,
  isCritical: true, isFixed: true, businessDayAdjustment: "NONE", overrides: [],
};

describe("generateInstances", () => {
  it("once-off in range produces one signed (negative) instance", () => {
    const r = generateInstances(base, d("2026-07-01"), d("2026-07-31"), []);
    expect(r).toHaveLength(1);
    expect(r[0]!.amount).toBe(-100);
  });

  it("once-off outside range produces nothing", () => {
    const r = generateInstances(base, d("2026-08-01"), d("2026-08-31"), []);
    expect(r).toHaveLength(0);
  });

  it("income keeps positive sign", () => {
    const r = generateInstances({ ...base, type: "INCOME" }, d("2026-07-01"), d("2026-07-31"), []);
    expect(r[0]!.amount).toBe(100);
  });

  it("weekly recurrence emits the right count", () => {
    const p = { ...base, frequency: "WEEKLY" as const, startDate: d("2026-07-01") };
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-29"), []);
    // Jul 1, 8, 15, 22, 29 => 5
    expect(r).toHaveLength(5);
  });

  it("monthly recurrence respects endDate", () => {
    const p = { ...base, frequency: "MONTHLY" as const, startDate: d("2026-07-15"), endDate: d("2026-09-15") };
    const r = generateInstances(p, d("2026-01-01"), d("2026-12-31"), []);
    expect(r.map(i => i.date.getMonth())).toEqual([6, 7, 8]); // Jul, Aug, Sep
  });

  it("skip override yields a skipped, zero-amount instance", () => {
    const p = {
      ...base, frequency: "WEEKLY" as const, startDate: d("2026-07-08"), isCritical: false,
      overrides: [{ id: "o1", originalDate: d("2026-07-08"), overriddenDate: null, overriddenAmount: null, isSkipped: true }],
    };
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-15"), []);
    const skipped = r.find(i => i.isSkipped);
    expect(skipped).toBeDefined();
    expect(skipped!.amount).toBe(0);
  });

  it("amount override replaces the amount (signed)", () => {
    const p = {
      ...base, frequency: "WEEKLY" as const, startDate: d("2026-07-08"), isFixed: false,
      overrides: [{ id: "o2", originalDate: d("2026-07-08"), overriddenDate: null, overriddenAmount: 250, isSkipped: false }],
    };
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-15"), []);
    const ov = r.find(i => i.isOverridden);
    expect(ov!.amount).toBe(-250); // expense stays negative
  });

  it("date override moves the instance and suppresses business-day adjustment", () => {
    const p = {
      ...base, frequency: "WEEKLY" as const, startDate: d("2026-07-08"), isCritical: false, businessDayAdjustment: "NEXT_BUSINESS_DAY" as const,
      overrides: [{ id: "o3", originalDate: d("2026-07-08"), overriddenDate: d("2026-07-09"), overriddenAmount: null, isSkipped: false }],
    };
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-15"), []);
    const moved = r.find(i => i.overrideId === "o3");
    expect(moved!.date.getTime()).toBe(d("2026-07-09").getTime());
  });

  it("business-day adjustment moves a weekend instance and flags it", () => {
    const p = { ...base, frequency: "ONCE_OFF" as const, startDate: d("2026-07-11"), businessDayAdjustment: "NEXT_BUSINESS_DAY" as const }; // Sat
    const r = generateInstances(p, d("2026-07-01"), d("2026-07-31"), []);
    expect(r[0]!.date.getTime()).toBe(d("2026-07-13").getTime()); // Mon
    expect(r[0]!.isMovedDueToHoliday).toBe(true);
  });
});

describe("recurrence across a DST transition", () => {
  // The engine compares dates in UTC, so stepping must be UTC-based. With a
  // local-time step (date-fns addWeeks), a UTC-midnight date in a TZ like
  // Pacific/Auckland slips back a day once DST starts (27 Sep 2026).
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = "Pacific/Auckland"; });
  afterAll(() => { process.env.TZ = originalTz; });

  it("fortnightly stays on the same weekday across DST", () => {
    const p = { ...base, frequency: "FORTNIGHTLY" as const, startDate: d("2026-09-08") };
    const r = generateInstances(p, d("2026-09-01"), d("2026-10-31"), []);
    expect(r.map((i) => i.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-08", "2026-09-22", "2026-10-06", "2026-10-20",
    ]);
    for (const i of r) expect(i.date.getUTCDay()).toBe(2); // Tuesday
  });

  it("weekly stays on the same weekday across DST", () => {
    const p = { ...base, frequency: "WEEKLY" as const, startDate: d("2026-09-22") };
    const r = generateInstances(p, d("2026-09-01"), d("2026-10-13"), []);
    expect(r.map((i) => i.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13",
    ]);
  });

  it("monthly keeps its day-of-month across DST", () => {
    const p = { ...base, frequency: "MONTHLY" as const, startDate: d("2026-09-15") };
    const r = generateInstances(p, d("2026-09-01"), d("2026-12-31"), []);
    expect(r.map((i) => i.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15",
    ]);
  });

  it("monthly clamps to the last day of a shorter month", () => {
    const p = { ...base, frequency: "MONTHLY" as const, startDate: d("2026-01-31") };
    const r = generateInstances(p, d("2026-01-01"), d("2026-03-31"), []);
    expect(r.map((i) => i.date.toISOString().slice(0, 10))).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-28",
    ]);
  });

  it("annual keeps its date across DST", () => {
    const p = { ...base, frequency: "ANNUAL" as const, startDate: d("2026-10-20") };
    const r = generateInstances(p, d("2026-01-01"), d("2028-12-31"), []);
    expect(r.map((i) => i.date.toISOString().slice(0, 10))).toEqual([
      "2026-10-20", "2027-10-20", "2028-10-20",
    ]);
  });
});

function transfer(over: Partial<EngineParticular> = {}): EngineParticular {
  return {
    id: "t1", name: "Card payment", type: "TRANSFER",
    accountId: "debit", toAccountId: "credit", amount: 100,
    frequency: "ONCE_OFF", startDate: new Date(Date.UTC(2026, 0, 10)),
    endDate: null, isCritical: true, isFixed: true, businessDayAdjustment: "NONE",
    overrides: [], ...over,
  };
}

it("a transfer instance is negative (the from-account leg)", () => {
  const out = generateInstances(transfer(), new Date(Date.UTC(2026, 0, 1)), new Date(Date.UTC(2026, 0, 31)), []);
  expect(out).toHaveLength(1);
  expect(out[0]!.amount).toBe(-100);
});
