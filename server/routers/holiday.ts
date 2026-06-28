import { z } from "zod";
import { router, protectedProcedure, resolveAccount } from "../trpc";
import { holidayInput } from "@/lib/schemas";

export const holidayRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.holiday.findMany({ where: { accountId: a.id }, orderBy: { date: "asc" } });
  }),
  create: protectedProcedure.input(holidayInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.holiday.create({ data: { ...input, accountId: a.id } });
  }),
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.holiday.deleteMany({ where: { id: input.id, accountId: a.id } });
  }),
});
