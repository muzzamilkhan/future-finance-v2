import { z } from "zod";
import { router, accountProcedure } from "../trpc";
import { assertCan } from "../permissions";
import { holidayInput, importHolidaysInput } from "@/lib/schemas";
import { fetchCountries, subdivisionsForCountry, fetchHolidays, filterHolidays } from "@/lib/holidayImport";

export const holidayRouter = router({
  list: accountProcedure.query(({ ctx }) =>
    ctx.prisma.holiday.findMany({ where: { accountId: ctx.account.id }, orderBy: { date: "asc" } })),

  create: accountProcedure.input(holidayInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    const { accountId: _a, ...rest } = input as typeof input & { accountId: string };
    return ctx.prisma.holiday.create({ data: { ...rest, accountId: ctx.account.id, source: "CUSTOM" } });
  }),

  delete: accountProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    return ctx.prisma.holiday.deleteMany({ where: { id: input.id, accountId: ctx.account.id } });
  }),

  availableCountries: accountProcedure.query(() => fetchCountries()),

  subdivisions: accountProcedure
    .input(z.object({ countryCode: z.string().length(2) }))
    .query(({ input }) => subdivisionsForCountry(input.countryCode, new Date().getFullYear())),

  import: accountProcedure.input(importHolidaysInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    const year = new Date().getFullYear();
    const holidays = filterHolidays(await fetchHolidays(input.countryCode, year), input.stateCode);

    let imported = 0;
    let updated = 0;
    await ctx.prisma.$transaction(async (tx) => {
      for (const h of holidays) {
        const existing = await tx.holiday.findUnique({
          where: { accountId_name_source: { accountId: ctx.account.id, name: h.name, source: "IMPORTED" } },
        });
        if (existing) updated++; else imported++;
        await tx.holiday.upsert({
          where: { accountId_name_source: { accountId: ctx.account.id, name: h.name, source: "IMPORTED" } },
          create: { accountId: ctx.account.id, name: h.name, date: new Date(h.date), isRecurring: true, source: "IMPORTED" },
          update: { date: new Date(h.date), isRecurring: true },
        });
      }
    });
    return { imported, updated };
  }),
});
