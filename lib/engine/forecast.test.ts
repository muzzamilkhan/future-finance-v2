import { describe, it, expect } from "vitest";
import { computeForecast } from "./forecast";
import type { EngineParticular, EngineAccount, ForecastInput } from "./types";

const d = (s: string) => new Date(s + "T00:00:00Z");

const debitAccount: EngineAccount = {
  id: "main", type: "DEBIT", anchorBalance: 1000, anchorDate: d("2026-07-01"), creditLimit: null,
};

const expense = (id: string, day: string, amt: number): EngineParticular => ({
  id, name: id, type: "EXPENSE", accountId: "main", toAccountId: null, amount: amt, frequency: "ONCE_OFF",
  startDate: d(day), endDate: null, isCritical: true, isFixed: true,
  businessDayAdjustment: "NONE", overrides: [],
});

const baseInput = (over: Partial<ForecastInput>): ForecastInput => ({
  accounts: [debitAccount],
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
    const jul2 = r.days.find(x => x.date.getUTCDate() === 2)!;
    expect(jul2.closingBalance).toBe(800);
  });

  it("anchors future-window balances to events BEFORE viewStart", () => {
    // anchorDate Jul 1, but we only DISPLAY Jul 4-5; an expense on Jul 2 must still count
    const r = computeForecast(baseInput({
      viewStart: d("2026-07-04"), viewEnd: d("2026-07-05"),
      particulars: [expense("rent", "2026-07-02", 200)],
    }));
    expect(r.days[0]!.date.getUTCDate()).toBe(4);      // display starts Jul 4
    expect(r.days[0]!.openingBalance).toBe(800);     // but reflects the Jul 2 expense
  });

  it("flags a negative day and reports firstNegative", () => {
    const r = computeForecast(baseInput({ particulars: [expense("big", "2026-07-02", 5000)] }));
    expect(r.firstNegative).not.toBeNull();
    expect(r.firstNegative!.date.getUTCDate()).toBe(2);
  });

  it("reports the lowest balance day", () => {
    const r = computeForecast(baseInput({
      particulars: [expense("a", "2026-07-02", 300), expense("b", "2026-07-03", 100)],
    }));
    expect(r.lowest!.date.getUTCDate()).toBe(3);
    expect(r.lowest!.closingBalance).toBe(600);
  });

  it("reports the highest balance day", () => {
    const income = (id: string, day: string, amt: number): EngineParticular => ({
      id, name: id, type: "INCOME", accountId: "main", toAccountId: null, amount: amt, frequency: "ONCE_OFF",
      startDate: d(day), endDate: null, isCritical: true, isFixed: true,
      businessDayAdjustment: "NONE", overrides: [],
    });
    const r = computeForecast(baseInput({
      particulars: [income("a", "2026-07-02", 300), income("b", "2026-07-03", 100)],
    }));
    // Jul 2 closes at 1300, Jul 3 at 1400 — Jul 3 is highest
    expect(r.highest!.date.getUTCDate()).toBe(3);
    expect(r.highest!.closingBalance).toBe(1400);
  });

  it("marks events overridable unless fixed AND critical", () => {
    const locked = expense("locked", "2026-07-02", 100); // isFixed + isCritical
    const flexible: EngineParticular = { ...locked, id: "flex", name: "flex", isFixed: false };
    const r = computeForecast(baseInput({ particulars: [locked, flexible] }));
    const jul2 = r.days.find((x) => x.date.getUTCDate() === 2)!;
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
    const flexEv = r.days.find((x) => x.date.getUTCDate() === 2)!.events.find((e) => e.particularId === "flex")!;
    const plainEv = r.days.find((x) => x.date.getUTCDate() === 3)!.events.find((e) => e.particularId === "plain")!;
    expect(flexEv.isOverridden).toBe(true);
    expect(flexEv.overrideId).toBe("ov-1");
    expect(plainEv.overrideId).toBeUndefined();
  });

  it("skipToday drops today's events", () => {
    const r = computeForecast(baseInput({
      today: d("2026-07-02"), skipToday: true,
      particulars: [expense("rent", "2026-07-02", 200)],
    }));
    const jul2 = r.days.find(x => x.date.getUTCDate() === 2)!;
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

// ── Multi-account / credit / transfer tests ────────────────────────────────

const day = (m: number, d: number) => new Date(Date.UTC(2026, m, d));

function input(particulars: EngineParticular[], accounts: EngineAccount[]) {
  return {
    accounts,
    viewStart: day(0, 1), viewEnd: day(0, 31),
    today: day(0, 1), skipToday: false,
    particulars, holidays: [],
  };
}

const debit: EngineAccount = { id: "debit", type: "DEBIT", anchorBalance: 1000, anchorDate: day(0, 1), creditLimit: null };
const credit: EngineAccount = { id: "credit", type: "CREDIT", anchorBalance: -200, anchorDate: day(0, 1), creditLimit: 1000 };

function p(over: Partial<EngineParticular>): EngineParticular {
  return {
    id: "x", name: "x", type: "EXPENSE", accountId: "debit", toAccountId: null, amount: 0,
    frequency: "ONCE_OFF", startDate: day(0, 5), endDate: null,
    isCritical: true, isFixed: true, businessDayAdjustment: "NONE", overrides: [], ...over,
  };
}

it("combined line on day 1 = debit cash + available credit", () => {
  const r = computeForecast(input([], [debit, credit]));
  // available credit = 1000 + (-200) = 800; combined = 1000 + 800 = 1800
  expect(r.days[0]!.combined).toBe(1800);
});

it("a debit expense lowers debit and the combined line", () => {
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "debit", amount: 100 })], [debit, credit]));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  expect(d5.accounts.find((a) => a.accountId === "debit")!.balance).toBe(900);
  expect(d5.combined).toBe(1700);
});

it("a credit expense lowers available credit and the combined line", () => {
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "credit", amount: 100 })], [debit, credit]));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  const c = d5.accounts.find((a) => a.accountId === "credit")!;
  expect(c.balance).toBe(-300);            // outstanding grew
  expect(c.availableCredit).toBe(700);     // 1000 + (-300)
  expect(d5.combined).toBe(1700);          // 1000 + 700
});

it("a debit->credit transfer nets to zero on the combined line", () => {
  const r = computeForecast(input(
    [p({ id: "t", type: "TRANSFER", accountId: "debit", toAccountId: "credit", amount: 150 })],
    [debit, credit],
  ));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  expect(d5.accounts.find((a) => a.accountId === "debit")!.balance).toBe(850);   // −150
  const c = d5.accounts.find((a) => a.accountId === "credit")!;
  expect(c.balance).toBe(-50);             // outstanding −200 + 150 paid down
  expect(c.availableCredit).toBe(950);     // 1000 + (-50)
  expect(d5.combined).toBe(1800);          // unchanged: 850 + 950
});

it("available credit may go negative (soft limit) and is flagged exhausted", () => {
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "credit", amount: 900 })], [debit, credit]));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  const c = d5.accounts.find((a) => a.accountId === "credit")!;
  expect(c.availableCredit).toBe(-100);    // 1000 + (-1100)
  expect(c.isExhausted).toBe(true);
});

it("transfer event carries from/to account ids", () => {
  const r = computeForecast(input(
    [p({ id: "t", type: "TRANSFER", accountId: "debit", toAccountId: "credit", amount: 150 })],
    [debit, credit],
  ));
  const d5 = r.days.find((x) => x.date.getUTCDate() === 5)!;
  const ev = d5.events.find((e) => e.particularId === "t")!;
  expect(ev.fromAccountId).toBe("debit");
  expect(ev.toAccountId).toBe("credit");
});
