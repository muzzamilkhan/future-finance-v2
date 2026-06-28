import { z } from "zod";
import { router, protectedProcedure, resolveAccount } from "../trpc";

export const forecastRouter = router({
  // Returns raw data for the FULL replay window [balanceUpdatedAt .. viewEnd].
  getData: protectedProcedure
    .input(z.object({ viewStart: z.coerce.date(), viewEnd: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const a = await resolveAccount(ctx.user.id);
      const windowStart = a.balanceUpdatedAt < input.viewStart ? a.balanceUpdatedAt : input.viewStart;

      const particulars = await ctx.prisma.particular.findMany({
        where: {
          accountId: a.id,
          OR: [
            { frequency: "ONCE_OFF", startDate: { gte: windowStart, lte: input.viewEnd } },
            { frequency: { not: "ONCE_OFF" }, startDate: { lte: input.viewEnd },
              OR: [{ endDate: null }, { endDate: { gte: windowStart } }] },
          ],
        },
        include: { overrides: { where: { originalDate: { gte: windowStart, lte: input.viewEnd } } } },
        orderBy: { startDate: "asc" },
      });

      const holidays = await ctx.prisma.holiday.findMany({
        where: {
          accountId: a.id,
          OR: [
            { isRecurring: false, date: { gte: windowStart, lte: input.viewEnd } },
            { isRecurring: true },
          ],
        },
        orderBy: { date: "asc" },
      });

      return {
        account: { currentBalance: Number(a.currentBalance), balanceUpdatedAt: a.balanceUpdatedAt },
        particulars, holidays,
      };
    }),
});
