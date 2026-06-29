import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, resolveAccount } from "../trpc";
import { particularInput, overrideInstanceInput } from "@/lib/schemas";
import { syncUserCategories } from "../categorySync";

export function assertOverrideAllowed(
  rule: { isFixed: boolean; isCritical: boolean },
  ov: { overriddenAmount?: number; overriddenDate?: Date; isSkipped: boolean },
) {
  if (ov.overriddenAmount !== undefined && rule.isFixed)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot override amount for a fixed particular" });
  if ((ov.overriddenDate !== undefined || ov.isSkipped) && rule.isCritical)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot override date or skip a critical particular" });
}

export const particularRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.particular.findMany({
      where: { accountId: a.id }, include: { overrides: true }, orderBy: { startDate: "asc" },
    });
  }),
  create: protectedProcedure.input(particularInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    const created = await ctx.prisma.particular.create({ data: { ...input, accountId: a.id } });
    await syncUserCategories(ctx.prisma, ctx.user.id, a.id);
    return created;
  }),
  update: protectedProcedure.input(particularInput.and(z.object({ id: z.string() })))
    .mutation(async ({ ctx, input }) => {
      const a = await resolveAccount(ctx.user.id);
      const { id, ...data } = input;
      const owned = await ctx.prisma.particular.findFirst({ where: { id, accountId: a.id } });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const updated = await ctx.prisma.particular.update({ where: { id }, data });
      await syncUserCategories(ctx.prisma, ctx.user.id, a.id);
      return updated;
    }),
  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    const result = await ctx.prisma.particular.deleteMany({ where: { id: input.id, accountId: a.id } });
    await syncUserCategories(ctx.prisma, ctx.user.id, a.id);
    return result;
  }),
  overrideInstance: protectedProcedure.input(overrideInstanceInput).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    const p = await ctx.prisma.particular.findFirst({ where: { id: input.particularId, accountId: a.id } });
    if (!p) throw new TRPCError({ code: "NOT_FOUND" });
    assertOverrideAllowed({ isFixed: p.isFixed, isCritical: p.isCritical }, input);
    return ctx.prisma.particularOverride.upsert({
      where: { particularId_originalDate: { particularId: input.particularId, originalDate: input.originalDate } },
      create: {
        particularId: input.particularId, originalDate: input.originalDate,
        overriddenAmount: input.overriddenAmount ?? null,
        overriddenDate: input.overriddenDate ?? null, isSkipped: input.isSkipped,
      },
      update: {
        overriddenAmount: input.overriddenAmount ?? null,
        overriddenDate: input.overriddenDate ?? null, isSkipped: input.isSkipped,
      },
    });
  }),
  deleteOverride: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    const ov = await ctx.prisma.particularOverride.findFirst({
      where: { id: input.id, particular: { accountId: a.id } },
    });
    if (!ov) throw new TRPCError({ code: "NOT_FOUND" });
    return ctx.prisma.particularOverride.delete({ where: { id: input.id } });
  }),
  listOverrides: protectedProcedure.input(z.object({ particularId: z.string() })).query(async ({ ctx, input }) => {
    const a = await resolveAccount(ctx.user.id);
    return ctx.prisma.particularOverride.findMany({
      where: { particularId: input.particularId, particular: { accountId: a.id } },
      orderBy: { originalDate: "asc" },
    });
  }),
});
