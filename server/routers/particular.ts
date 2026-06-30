import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, accountProcedure } from "../trpc";
import { assertCan } from "../permissions";
import { particularInput, overrideInstanceInput } from "@/lib/schemas";
import { syncAccountCategories } from "../categorySync";

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
  list: accountProcedure.query(({ ctx }) =>
    ctx.prisma.particular.findMany({
      where: { accountId: ctx.account.id }, include: { overrides: true }, orderBy: { startDate: "asc" },
    })),

  create: accountProcedure.input(particularInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editItems");
    const { accountId: _accountId, ...rest } = input as typeof input & { accountId: string };
    const created = await ctx.prisma.particular.create({
      data: { ...rest, category: rest.category ?? null, accountId: ctx.account.id },
    });
    await syncAccountCategories(ctx.prisma, ctx.account.id);
    return created;
  }),

  update: accountProcedure.input(particularInput.and(z.object({ id: z.string() })))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.membership, "editItems");
      const { id, accountId: _a, ...data } = input as typeof input & { accountId: string };
      const owned = await ctx.prisma.particular.findFirst({ where: { id, accountId: ctx.account.id } });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const updated = await ctx.prisma.particular.update({
        where: { id }, data: { ...data, category: data.category ?? null },
      });
      await syncAccountCategories(ctx.prisma, ctx.account.id);
      return updated;
    }),

  delete: accountProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editItems");
    const result = await ctx.prisma.particular.deleteMany({ where: { id: input.id, accountId: ctx.account.id } });
    await syncAccountCategories(ctx.prisma, ctx.account.id);
    return result;
  }),

  overrideInstance: accountProcedure.input(overrideInstanceInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editOverrides");
    const p = await ctx.prisma.particular.findFirst({ where: { id: input.particularId, accountId: ctx.account.id } });
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

  deleteOverride: accountProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editOverrides");
    const ov = await ctx.prisma.particularOverride.findFirst({
      where: { id: input.id, particular: { accountId: ctx.account.id } },
    });
    if (!ov) throw new TRPCError({ code: "NOT_FOUND" });
    return ctx.prisma.particularOverride.delete({ where: { id: input.id } });
  }),

  listOverrides: accountProcedure.input(z.object({ particularId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.prisma.particularOverride.findMany({
      where: { particularId: input.particularId, particular: { accountId: ctx.account.id } },
      orderBy: { originalDate: "asc" },
    });
  }),
});
