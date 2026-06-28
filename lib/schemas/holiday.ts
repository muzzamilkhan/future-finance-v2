import { z } from "zod";

export const holidayInput = z.object({
  name: z.string().min(1).max(200),
  date: z.coerce.date(),
  isRecurring: z.boolean().default(false),
});

export type HolidayInput = z.infer<typeof holidayInput>;
