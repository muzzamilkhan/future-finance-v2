export type Frequency = "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL";
export type BdaAdjustment = "NONE" | "NEXT_BUSINESS_DAY" | "PREVIOUS_BUSINESS_DAY";
export type ParticularType = "INCOME" | "EXPENSE";

export interface EngineOverride {
  id: string;
  originalDate: Date;
  overriddenDate: Date | null;
  overriddenAmount: number | null;
  isSkipped: boolean;
}

export interface EngineParticular {
  id: string;
  name: string;
  type: ParticularType;
  amount: number; // always positive; sign applied from type
  frequency: Frequency;
  startDate: Date;
  endDate: Date | null;
  isCritical: boolean;
  isFixed: boolean;
  businessDayAdjustment: BdaAdjustment;
  overrides: EngineOverride[];
}

export interface EngineHoliday {
  date: Date;
  isRecurring: boolean;
}

export interface Instance {
  date: Date;
  amount: number; // signed
  isOverridden: boolean;
  isSkipped: boolean;
  isMovedDueToHoliday: boolean;
  originalDate?: Date;
  overrideId?: string;
}

export interface DailyEvent {
  particularId: string;
  name: string;
  amount: number; // signed
  kind: "income" | "expense";
  isOverridden: boolean;
  isSkipped: boolean;
  isMovedDueToHoliday: boolean;
  // false when the particular is both fixed AND critical — nothing to override
  // (amount needs !isFixed; date/skip needs !isCritical).
  isOverridable: boolean;
  originalDate?: Date;
  overrideId?: string;
}

export interface DailyBalance {
  date: Date;
  openingBalance: number;
  closingBalance: number;
  events: DailyEvent[];
  isNegative: boolean;
}

export interface MonthlySummary {
  month: Date;
  totalIncome: number;
  totalExpenses: number;
  netChange: number;
  openingBalance: number;
  closingBalance: number;
  daysWithNegativeBalance: number;
}

export type { ForecastInput, ForecastResult } from "./forecast";
