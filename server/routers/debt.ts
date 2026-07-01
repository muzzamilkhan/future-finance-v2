import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { debtInputSchema } from "@/lib/schemas";

/** Throws unless `requested` is exactly a permutation of `current` (no missing/extra/dupes). */
export function assertReorderIds(current: string[], requested: string[]): void {
  const currentSet = new Set(current);
  const seen = new Set<string>();
  if (requested.length !== current.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "reorder ids must match your debts exactly" });
  }
  for (const id of requested) {
    if (!currentSet.has(id) || seen.has(id)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "reorder ids must match your debts exactly" });
    }
    seen.add(id);
  }
}

export const debtRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.debt.findMany({
      where: { userId: ctx.user.id },
      orderBy: { sortOrder: "asc" },
    })),

  create: protectedProcedure.input(debtInputSchema).mutation(async ({ ctx, input }) => {
    const max = await ctx.prisma.debt.aggregate({
      where: { userId: ctx.user.id },
      _max: { sortOrder: true },
    });
    return ctx.prisma.debt.create({
      data: { ...input, userId: ctx.user.id, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
  }),

  update: protectedProcedure
    .input(debtInputSchema.and(z.object({ id: z.string() })))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const owned = await ctx.prisma.debt.findFirst({ where: { id, userId: ctx.user.id } });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.debt.update({ where: { id }, data });
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) =>
    ctx.prisma.debt.deleteMany({ where: { id: input.id, userId: ctx.user.id } })),

  reorder: protectedProcedure.input(z.object({ ids: z.array(z.string()) })).mutation(async ({ ctx, input }) => {
    const current = await ctx.prisma.debt.findMany({
      where: { userId: ctx.user.id },
      select: { id: true },
    });
    assertReorderIds(current.map((d) => d.id), input.ids);
    await ctx.prisma.$transaction(
      input.ids.map((id, i) =>
        ctx.prisma.debt.update({ where: { id }, data: { sortOrder: i } })),
    );
    return { count: input.ids.length };
  }),
});
