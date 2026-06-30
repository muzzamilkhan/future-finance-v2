import { z } from "zod";
import { particularInput } from "./particular";

/**
 * Shape of a stored particular as it comes back from the API — kept loose so this
 * module stays free of React/Prisma imports (see CLAUDE.md). `amount` is anything
 * Number()-able — covers a Prisma Decimal (via toString) as well as number/string;
 * dates may be strings or Date.
 */
export type StoredParticular = {
  name: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number | string | { toString(): string };
  frequency: "ONCE_OFF" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "ANNUAL";
  startDate: Date | string;
  endDate?: Date | string | null;
  isCritical: boolean;
  isFixed: boolean;
  businessDayAdjustment: "NONE" | "NEXT_BUSINESS_DAY" | "PREVIOUS_BUSINESS_DAY";
  category?: string | null;
  accountId?: string | null;
  toAccountId?: string | null;
};

/**
 * Maps a stored particular to the form/input shape `particularInput` expects.
 * Single source of truth shared by the edit form and inline category editing so
 * the two can't drift. Mirrors the field handling the form has always used:
 * amount is made positive, dates are coerced to `Date`, and a null/absent
 * category becomes `""` (which the schema treats as "no category").
 */
export function toParticularInput(p: StoredParticular): z.input<typeof particularInput> {
  return {
    name: p.name,
    type: p.type,
    amount: Math.abs(Number(p.amount)),
    frequency: p.frequency,
    startDate: new Date(p.startDate),
    endDate: p.endDate ? new Date(p.endDate) : undefined,
    isCritical: p.isCritical,
    isFixed: p.isFixed,
    businessDayAdjustment: p.businessDayAdjustment,
    category: p.category ?? "",
    toAccountId: p.toAccountId ?? undefined,
  };
}
