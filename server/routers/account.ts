import { router, protectedProcedure, resolveAccount } from "../trpc";
import { updateBalanceInput } from "@/lib/schemas";

export const accountRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const a = await resolveAccount(ctx.user.id);
    return { id: a.id, name: a.name, currentBalance: Number(a.currentBalance), balanceUpdatedAt: a.balanceUpdatedAt };
  }),
  updateBalance: protectedProcedure.input(updateBalanceInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.financeAccount.update({
      where: { id: a.id },
      data: { currentBalance: input.balance, balanceUpdatedAt: new Date() },
    });
  }),
});
