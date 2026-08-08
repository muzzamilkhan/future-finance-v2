import { router, protectedProcedure } from "../trpc";
import { preferencesInput } from "@/lib/schemas";
import { resolvePreferences } from "@/lib/preferences";

const select = { timeZone: true, currency: true } as const;

export const preferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const row = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id }, select,
    });
    return resolvePreferences(row);
  }),

  // The user's explicit choice — unconditional.
  update: protectedProcedure.input(preferencesInput).mutation(async ({ ctx, input }) => {
    const row = await ctx.prisma.user.update({
      where: { id: ctx.user.id },
      data: { ...(input.timeZone ? { timeZone: input.timeZone } : {}),
              ...(input.currency ? { currency: input.currency } : {}) },
      select,
    });
    return resolvePreferences(row);
  }),

  // Write-once. Each column is filled ONLY while it is still null, enforced in the
  // WHERE clause so the check and the write are one atomic statement. A second tab,
  // a double-mount, or a stale client therefore can never clobber a manual choice —
  // a read-then-write would race here.
  detect: protectedProcedure.input(preferencesInput).mutation(async ({ ctx, input }) => {
    if (input.timeZone) {
      await ctx.prisma.user.updateMany({
        where: { id: ctx.user.id, timeZone: null },
        data: { timeZone: input.timeZone },
      });
    }
    if (input.currency) {
      await ctx.prisma.user.updateMany({
        where: { id: ctx.user.id, currency: null },
        data: { currency: input.currency },
      });
    }
    const row = await ctx.prisma.user.findUniqueOrThrow({
      where: { id: ctx.user.id }, select,
    });
    return resolvePreferences(row);
  }),
});
