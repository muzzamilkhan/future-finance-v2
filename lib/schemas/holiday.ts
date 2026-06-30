import { z } from "zod";

export const holidayInput = z.object({
  name: z.string().min(1).max(200),
  date: z.coerce.date(),
  isRecurring: z.boolean().default(false),
});

export type HolidayInput = z.infer<typeof holidayInput>;

export const importHolidaysInput = z.object({
  countryCode: z.string().length(2),
  stateCode: z.string().optional(),
});

export type ImportHolidaysInput = z.infer<typeof importHolidaysInput>;
