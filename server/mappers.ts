import type { EngineParticular, EngineHoliday, EngineOverride } from "@/lib/engine";

type DecimalLike = { toString(): string } | number;
const num = (d: DecimalLike): number => (typeof d === "number" ? d : Number(d.toString()));

interface PrismaOverride {
  id: string; originalDate: Date;
  overriddenDate: Date | null; overriddenAmount: DecimalLike | null; isSkipped: boolean;
}
interface PrismaParticular {
  id: string; name: string; type: "INCOME" | "EXPENSE"; amount: DecimalLike;
  frequency: EngineParticular["frequency"]; startDate: Date; endDate: Date | null;
  isCritical: boolean; isFixed: boolean;
  businessDayAdjustment: EngineParticular["businessDayAdjustment"];
  overrides: PrismaOverride[];
}

function toEngineOverride(o: PrismaOverride): EngineOverride {
  return {
    id: o.id, originalDate: o.originalDate, overriddenDate: o.overriddenDate,
    overriddenAmount: o.overriddenAmount === null ? null : Math.abs(num(o.overriddenAmount)),
    isSkipped: o.isSkipped,
  };
}

export function toEngineParticular(p: PrismaParticular): EngineParticular {
  return {
    id: p.id, name: p.name, type: p.type,
    amount: Math.abs(num(p.amount)),
    frequency: p.frequency, startDate: p.startDate, endDate: p.endDate,
    isCritical: p.isCritical, isFixed: p.isFixed,
    businessDayAdjustment: p.businessDayAdjustment,
    overrides: p.overrides.map(toEngineOverride),
  };
}

export function toEngineHoliday(h: { date: Date; isRecurring: boolean }): EngineHoliday {
  return { date: h.date, isRecurring: h.isRecurring };
}
