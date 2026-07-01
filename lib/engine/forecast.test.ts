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

// ── C1: per-account replay from each account's own anchor ──────────────────

it("seeds a later-anchored credit account at its own anchor, not replayStart", () => {
  // Debit anchored Jan 1 @ 1000; credit anchored Jun 1 @ -200 (already reflects
  // Jan–May spend). Recurring $100/mo credit expense since Jan 1 PLUS a Jun 1
  // instance — the credit account must open at its anchor (-200), with NONE of the
  // Jan–May instances re-applied, then the Jun 1 instance closes it to -300.
  const debitJan: EngineAccount = {
    id: "debit", type: "DEBIT", anchorBalance: 1000, anchorDate: day(0, 1), creditLimit: null,
  };
  const creditJun: EngineAccount = {
    id: "credit", type: "CREDIT", anchorBalance: -200, anchorDate: day(5, 1), creditLimit: 1000,
  };
  // Pre-anchor recurring history (Jan, Feb, …) that must NOT be re-applied, plus the
  // single in-window instance on the activation day. Modeled as explicit once-offs so
  // the assertion is independent of the separate monthly-recurrence date handling.
  const preAnchor = [day(0, 1), day(1, 1), day(2, 1), day(3, 1), day(4, 1)].map((dt, i) =>
    p({ id: `pre${i}`, type: "EXPENSE", accountId: "credit", amount: 100, startDate: dt }),
  );
  const junInstance = p({ id: "jun", type: "EXPENSE", accountId: "credit", amount: 100, startDate: day(5, 1) });

  const r = computeForecast({
    accounts: [debitJan, creditJun],
    viewStart: day(5, 1), viewEnd: day(5, 30),
    today: day(5, 1), skipToday: false,
    particulars: [...preAnchor, junInstance], holidays: [],
  });

  const jun1 = r.days[0]!;
  expect(jun1.date.getUTCDate()).toBe(1);
  const c = jun1.accounts.find((a) => a.accountId === "credit")!;
  // Opening on activation day == anchorBalance combination; the Jun 1 instance closes it.
  expect(jun1.openingBalance).toBe(1000 + (1000 + -200)); // debit 1000 + availCredit 800 = 1800
  expect(c.balance).toBe(-300);          // -200 anchor + the single June instance (-100)
  expect(c.availableCredit).toBe(700);   // 1000 + (-300)
  // No Jan–May instances re-applied on top of the anchor.
  expect(c.balance).not.toBe(-800);
});

it("combined line at the later anchor = debit + (creditLimit + creditAnchor), no double-apply", () => {
  const debitJan: EngineAccount = {
    id: "debit", type: "DEBIT", anchorBalance: 1000, anchorDate: day(0, 1), creditLimit: null,
  };
  const creditJun: EngineAccount = {
    id: "credit", type: "CREDIT", anchorBalance: -200, anchorDate: day(5, 1), creditLimit: 1000,
  };
  // Recurring pre-anchor item on the credit account; with no instance ON Jun 1
  // the activation-day opening AND closing equal the pure anchor combination.
  const monthly = p({
    id: "cc", type: "EXPENSE", accountId: "credit", amount: 100,
    frequency: "MONTHLY", startDate: day(0, 15), // 15th of each month, not the 1st
  });
  const r = computeForecast({
    accounts: [debitJan, creditJun],
    viewStart: day(5, 1), viewEnd: day(5, 10),
    today: day(5, 1), skipToday: false,
    particulars: [monthly], holidays: [],
  });
  const jun1 = r.days[0]!;
  // debitBalance + (creditLimit + creditAnchorBalance) = 1000 + (1000 + -200) = 1800
  expect(jun1.combined).toBe(1800);
  expect(jun1.openingBalance).toBe(1800);
});

it("excludes an inactive account from the combined line before its anchor", () => {
  // Debit anchored Jan 1, credit anchored Jun 1; view a window that starts before
  // the credit account exists (replayStart = Jan 1, displayed from May 30).
  const debitJan: EngineAccount = {
    id: "debit", type: "DEBIT", anchorBalance: 1000, anchorDate: day(0, 1), creditLimit: null,
  };
  const creditJun: EngineAccount = {
    id: "credit", type: "CREDIT", anchorBalance: -200, anchorDate: day(5, 1), creditLimit: 1000,
  };
  const r = computeForecast({
    accounts: [debitJan, creditJun],
    viewStart: day(4, 30), viewEnd: day(5, 2), // May 30 → Jun 2
    today: day(4, 30), skipToday: false,
    particulars: [], holidays: [],
  });
  const may30 = r.days.find((x) => x.date.getUTCMonth() === 4 && x.date.getUTCDate() === 30)!;
  // Credit not yet active: combined is debit-only.
  expect(may30.combined).toBe(1000);
  expect(may30.accounts.find((a) => a.accountId === "credit")).toBeUndefined();
  const jun1 = r.days.find((x) => x.date.getUTCMonth() === 5 && x.date.getUTCDate() === 1)!;
  expect(jun1.combined).toBe(1000 + (1000 + -200)); // 1800 once credit activates
  expect(jun1.accounts.find((a) => a.accountId === "credit")).toBeDefined();
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

it("nets a transfer to zero on the combined line yet flags the overdrawn source", () => {
  // debit has 1000; transfer 1200 out to credit. Combined stays flat, but debit -> -200.
  const r = computeForecast(input(
    [p({ id: "t", type: "TRANSFER", accountId: "debit", toAccountId: "credit", amount: 1200 })],
    [debit, credit],
  ));
  const jan5 = r.days.find(x => x.date.getUTCDate() === 5)!;
  // combined unchanged by a same-day transfer, so no combined-negative day:
  expect(r.firstNegative).toBeNull();
  // but the source account is exhausted that day:
  expect(jan5.hasExhaustedAccount).toBe(true);
  const ex = r.exhaustions.find(e => e.accountId === "debit")!;
  expect(ex).toBeDefined();
  expect(ex.date.getUTCDate()).toBe(5);
  expect(ex.balance).toBe(-200);
  expect(ex.type).toBe("DEBIT");
  expect(ex.availableCredit).toBeNull();
});

it("reports a credit account pushed past its limit as an exhaustion", () => {
  // credit anchor -200, limit 1000 => availableCredit 800. A 900 expense -> availableCredit -100.
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "credit", amount: 900 })], [debit, credit]));
  const ex = r.exhaustions.find(e => e.accountId === "credit")!;
  expect(ex).toBeDefined();
  expect(ex.type).toBe("CREDIT");
  expect(ex.availableCredit).toBe(-100);
});

it("records only the FIRST day an account is exhausted", () => {
  const r = computeForecast(input(
    [
      p({ id: "a", type: "EXPENSE", accountId: "debit", amount: 1200, startDate: day(0, 5) }),
      p({ id: "b", type: "EXPENSE", accountId: "debit", amount: 50, startDate: day(0, 9) }),
    ],
    [debit],
  ));
  const debitExhaustions = r.exhaustions.filter(e => e.accountId === "debit");
  expect(debitExhaustions).toHaveLength(1);
  expect(debitExhaustions[0]!.date.getUTCDate()).toBe(5);
});

it("returns no exhaustions and hasExhaustedAccount false when all accounts stay solvent", () => {
  const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "debit", amount: 100 })], [debit, credit]));
  expect(r.exhaustions).toEqual([]);
  expect(r.days.every(d => d.hasExhaustedAccount === false)).toBe(true);
});

it("orders exhaustions by date ascending across accounts", () => {
  // credit exhausted Jan 5, debit exhausted Jan 9.
  const r = computeForecast(input(
    [
      p({ id: "c", type: "EXPENSE", accountId: "credit", amount: 900, startDate: day(0, 5) }),
      p({ id: "d", type: "EXPENSE", accountId: "debit", amount: 1100, startDate: day(0, 9) }),
    ],
    [debit, credit],
  ));
  expect(r.exhaustions.map(e => e.accountId)).toEqual(["credit", "debit"]);
});

describe("lowestByAccount", () => {
  it("is empty when there are no days", () => {
    const r = computeForecast({ ...input([], [debit]), viewStart: day(0, 31), viewEnd: day(0, 1) });
    expect(r.lowestByAccount).toEqual([]);
  });

  it("has one entry for a single account", () => {
    const r = computeForecast(input([], [debit]));
    expect(r.lowestByAccount).toHaveLength(1);
    expect(r.lowestByAccount[0]!.accountId).toBe("debit");
  });

  it("tracks each debit account's own lowest by balance and date", () => {
    // debit dips to 900 on the 5th (100 expense) and stays there through end
    const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "debit", amount: 100 })], [debit]));
    const low = r.lowestByAccount.find((a) => a.accountId === "debit")!;
    expect(low.balance).toBe(900);
    expect(low.date.getUTCDate()).toBe(5); // first day it reaches the running min
  });

  it("uses available credit as the low figure for CREDIT accounts", () => {
    // credit expense on the 5th: available drops 800 -> 700 and stays
    const r = computeForecast(input([p({ id: "e", type: "EXPENSE", accountId: "credit", amount: 100 })], [debit, credit]));
    const low = r.lowestByAccount.find((a) => a.accountId === "credit")!;
    expect(low.availableCredit).toBe(700);
    expect(low.date.getUTCDate()).toBe(5); // first day it reaches 700
  });

  it("picks the earliest day on a tie", () => {
    // 100 expense on the 5th (debit -> 900), then a 0 expense on the 10th (still 900).
    // Running min (900) is first reached on the 5th.
    const r = computeForecast(input(
      [
        p({ id: "e1", type: "EXPENSE", accountId: "debit", amount: 100, startDate: day(0, 5) }),
        p({ id: "e2", type: "EXPENSE", accountId: "debit", amount: 0, startDate: day(0, 10) }),
      ],
      [debit],
    ));
    const low = r.lowestByAccount.find((a) => a.accountId === "debit")!;
    expect(low.balance).toBe(900);
    expect(low.date.getUTCDate()).toBe(5);
  });
});
