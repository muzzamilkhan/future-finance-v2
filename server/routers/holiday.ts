import { z } from "zod";
import { router, accountProcedure } from "../trpc";
import { assertCan } from "../permissions";
import { holidayInput } from "@/lib/schemas";

export const holidayRouter = router({
  list: accountProcedure.query(({ ctx }) =>
    ctx.prisma.holiday.findMany({ where: { accountId: ctx.account.id }, orderBy: { date: "asc" } })),

  create: accountProcedure.input(holidayInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    const { accountId: _a, ...rest } = input as typeof input & { accountId: string };
    return ctx.prisma.holiday.create({ data: { ...rest, accountId: ctx.account.id } });
  }),

  delete: accountProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editHolidays");
    return ctx.prisma.holiday.deleteMany({ where: { id: input.id, accountId: ctx.account.id } });
  }),
});
