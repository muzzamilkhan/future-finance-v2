import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { holidayInput, importHolidaysInput } from "@/lib/schemas";
import { fetchCountries, subdivisionsForCountry, fetchHolidays, filterHolidays } from "@/lib/holidayImport";
import { currentYearInZone, resolvePreferences } from "@/lib/preferences";
import type { Context } from "../trpc";

/**
 * The current year in the caller's own timezone, not the server's. Holidays are
 * imported a year at a time and the server runs in UTC, so without this a Sydney user
 * importing on New Year's Eve would get the previous year's dates.
 */
async function callerYear(prisma: Context["prisma"], userId: string): Promise<number> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId }, select: { timeZone: true, currency: true },
  });
  return currentYearInZone(new Date(), resolvePreferences(row).timeZone);
}

export const holidayRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.holiday.findMany({ where: { userId: ctx.user.id }, orderBy: { date: "asc" } })),

  create: protectedProcedure.input(holidayInput).mutation(async ({ ctx, input }) =>
    ctx.prisma.holiday.create({ data: { ...input, userId: ctx.user.id, source: "CUSTOM" } })),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) =>
    ctx.prisma.holiday.deleteMany({ where: { id: input.id, userId: ctx.user.id } })),

  availableCountries: protectedProcedure.query(() => fetchCountries()),

  subdivisions: protectedProcedure
    .input(z.object({ countryCode: z.string().length(2) }))
    .query(async ({ ctx, input }) =>
      subdivisionsForCountry(input.countryCode, await callerYear(ctx.prisma, ctx.user.id))),

  import: protectedProcedure.input(importHolidaysInput).mutation(async ({ ctx, input }) => {
    const year = await callerYear(ctx.prisma, ctx.user.id);
    const holidays = filterHolidays(await fetchHolidays(input.countryCode, year), input.stateCode);

    // Dedupe by name (the unique key is (userId, name, source)); keep the last occurrence.
    const byName = new Map(holidays.map((h) => [h.name, h]));
    const data = [...byName.values()].map((h) => ({
      userId: ctx.user.id,
      name: h.name,
      date: new Date(h.date),
      isRecurring: true,
      source: "IMPORTED" as const,
    }));

    // Replace: drop all previously imported holidays, then insert the fresh set.
    await ctx.prisma.$transaction([
      ctx.prisma.holiday.deleteMany({ where: { userId: ctx.user.id, source: "IMPORTED" } }),
      ctx.prisma.holiday.createMany({ data }),
    ]);

    return { imported: data.length };
  }),
});
