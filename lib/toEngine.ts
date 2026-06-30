import type { EngineParticular, EngineHoliday, EngineAccount } from "@/lib/engine";

type Row = {
  account: { id: string; currentBalance: number; balanceUpdatedAt: Date };
  particulars: Array<{
    id: string; name: string; type: "INCOME" | "EXPENSE"; accountId?: string; toAccountId?: string | null;
    amount: string | number; frequency: EngineParticular["frequency"]; startDate: Date; endDate: Date | null;
    isCritical: boolean; isFixed: boolean; businessDayAdjustment: EngineParticular["businessDayAdjustment"];
    overrides: Array<{ id: string; originalDate: Date; overriddenDate: Date | null;
      overriddenAmount: string | number | null; isSkipped: boolean }>;
  }>;
  holidays: Array<{ date: Date; isRecurring: boolean }>;
};

const num = (v: string | number) => (typeof v === "number" ? v : Number(v));

type CombinedRow = {
  accounts: Array<{
    id: string; name: string; type: "DEBIT" | "CREDIT";
    currentBalance: number; balanceUpdatedAt: Date; creditLimit: number | null;
  }>;
  particulars: Array<{
    id: string; name: string; type: "INCOME" | "EXPENSE" | "TRANSFER"; accountId: string; toAccountId: string | null;
    amount: string | number; frequency: EngineParticular["frequency"]; startDate: Date; endDate: Date | null;
    isCritical: boolean; isFixed: boolean; businessDayAdjustment: EngineParticular["businessDayAdjustment"];
    overrides: Array<{ id: string; originalDate: Date; overriddenDate: Date | null;
      overriddenAmount: string | number | null; isSkipped: boolean }>;
  }>;
  holidays: Array<{ date: Date; isRecurring: boolean }>;
};

export function toCombinedEngineInputs(data: CombinedRow) {
  const accounts: EngineAccount[] = data.accounts.map((a) => ({
    id: a.id, type: a.type,
    anchorBalance: a.currentBalance, anchorDate: new Date(a.balanceUpdatedAt),
    creditLimit: a.creditLimit,
  }));
  const particulars: EngineParticular[] = data.particulars.map((p) => ({
    id: p.id, name: p.name, type: p.type, accountId: p.accountId, toAccountId: p.toAccountId,
    amount: Math.abs(num(p.amount)), frequency: p.frequency,
    startDate: new Date(p.startDate), endDate: p.endDate ? new Date(p.endDate) : null,
    isCritical: p.isCritical, isFixed: p.isFixed, businessDayAdjustment: p.businessDayAdjustment,
    overrides: p.overrides.map((o) => ({
      id: o.id, originalDate: new Date(o.originalDate),
      overriddenDate: o.overriddenDate ? new Date(o.overriddenDate) : null,
      overriddenAmount: o.overriddenAmount === null ? null : Math.abs(num(o.overriddenAmount)),
      isSkipped: o.isSkipped,
    })),
  }));
  const holidays: EngineHoliday[] = data.holidays.map((h) => ({ date: new Date(h.date), isRecurring: h.isRecurring }));
  return { accounts, particulars, holidays };
}

export function toEngineInputs(data: Row) {
  const particulars: EngineParticular[] = data.particulars.map((p) => ({
    id: p.id, name: p.name, type: p.type,
    accountId: p.accountId ?? data.account.id, toAccountId: p.toAccountId ?? null,
    amount: Math.abs(num(p.amount)), frequency: p.frequency, startDate: new Date(p.startDate),
    endDate: p.endDate ? new Date(p.endDate) : null,
    isCritical: p.isCritical, isFixed: p.isFixed, businessDayAdjustment: p.businessDayAdjustment,
    overrides: p.overrides.map((o) => ({
      id: o.id, originalDate: new Date(o.originalDate),
      overriddenDate: o.overriddenDate ? new Date(o.overriddenDate) : null,
      overriddenAmount: o.overriddenAmount === null ? null : Math.abs(num(o.overriddenAmount)),
      isSkipped: o.isSkipped,
    })),
  }));
  const holidays: EngineHoliday[] = data.holidays.map((h) => ({ date: new Date(h.date), isRecurring: h.isRecurring }));
  return {
    anchorBalance: data.account.currentBalance,
    anchorDate: new Date(data.account.balanceUpdatedAt),
    particulars, holidays,
  };
}
