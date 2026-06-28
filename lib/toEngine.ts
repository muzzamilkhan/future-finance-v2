import type { EngineParticular, EngineHoliday } from "@/lib/engine";

type Row = {
  account: { currentBalance: number; balanceUpdatedAt: Date };
  particulars: Array<{
    id: string; name: string; type: "INCOME" | "EXPENSE"; amount: string | number;
    frequency: EngineParticular["frequency"]; startDate: Date; endDate: Date | null;
    isCritical: boolean; isFixed: boolean; businessDayAdjustment: EngineParticular["businessDayAdjustment"];
    overrides: Array<{ id: string; originalDate: Date; overriddenDate: Date | null;
      overriddenAmount: string | number | null; isSkipped: boolean }>;
  }>;
  holidays: Array<{ date: Date; isRecurring: boolean }>;
};

const num = (v: string | number) => (typeof v === "number" ? v : Number(v));

export function toEngineInputs(data: Row) {
  const particulars: EngineParticular[] = data.particulars.map((p) => ({
    id: p.id, name: p.name, type: p.type, amount: Math.abs(num(p.amount)),
    frequency: p.frequency, startDate: new Date(p.startDate),
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
