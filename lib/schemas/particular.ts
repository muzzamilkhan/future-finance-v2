import { z } from "zod";
import { normalizeCategory } from "@/lib/spending/category";

export const particularType = z.enum(["INCOME", "EXPENSE", "TRANSFER"]);
export const frequency = z.enum(["ONCE_OFF", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "ANNUAL"]);
export const bdaAdjustment = z.enum(["NONE", "NEXT_BUSINESS_DAY", "PREVIOUS_BUSINESS_DAY"]);

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export const particularInput = z.object({
  name: z.string().min(1).max(200),
  type: particularType,
  amount: z.number().positive("Amount must be positive"),
  frequency,
  startDate: z.coerce.date(),
  endDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  isCritical: z.boolean().default(true),
  isFixed: z.boolean().default(true),
  businessDayAdjustment: bdaAdjustment.default("NONE"),
  category: z.preprocess(
    emptyToUndefined,
    z.string().transform((s) => normalizeCategory(s)).optional(),
  ).transform((v) => (v === "" ? undefined : v)),
  accountId: z.string().optional(),
  toAccountId: z.preprocess(emptyToUndefined, z.string().optional()),
}).refine((v) => !v.endDate || v.endDate >= v.startDate, {
  message: "End date must be on or after start date", path: ["endDate"],
}).refine((v) => v.type !== "TRANSFER" || (!!v.toAccountId && v.toAccountId !== v.accountId), {
  message: "Transfers need a different destination account", path: ["toAccountId"],
}).refine((v) => v.type === "TRANSFER" || !v.toAccountId, {
  message: "Only transfers may set a destination account", path: ["toAccountId"],
});

export const overrideInstanceInput = z.object({
  particularId: z.string(),
  originalDate: z.coerce.date(),
  overriddenAmount: z.number().optional(),
  overriddenDate: z.coerce.date().optional(),
  isSkipped: z.boolean().default(false),
});

export type ParticularInput = z.infer<typeof particularInput>;
export type OverrideInstanceInput = z.infer<typeof overrideInstanceInput>;
