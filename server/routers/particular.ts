import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, accountProcedure, protectedProcedure } from "../trpc";
import { assertCan } from "../permissions";
import { particularInput, overrideInstanceInput } from "@/lib/schemas";
import { syncAccountCategories } from "../categorySync";
import { assertTransferShape } from "../transfers";
import type { PrismaClient } from "@prisma/client";

export function assertOverrideAllowed(
  rule: { isFixed: boolean; isCritical: boolean },
  ov: { overriddenAmount?: number; overriddenDate?: Date; isSkipped: boolean },
) {
  if (ov.overriddenAmount !== undefined && rule.isFixed)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot override amount for a fixed particular" });
  if ((ov.overriddenDate !== undefined || ov.isSkipped) && rule.isCritical)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot override date or skip a critical particular" });
}

export async function ownedAccountIds(
  prisma: Pick<PrismaClient, "accountMembership">,
  userId: string,
): Promise<Set<string>> {
  const ms = await prisma.accountMembership.findMany({
    where: { userId, account: { closedAt: null } }, select: { accountId: true },
  });
  return new Set(ms.map((m) => m.accountId));
}

/** Throws if a particular cannot be reassigned to `toAccountId`. Pure, testable. */
export function assertReassignAllowed(
  p: { type: "INCOME" | "EXPENSE" | "TRANSFER" },
  fromAccountId: string,
  toAccountId: string,
  ownedAccountIds: Set<string>,
) {
  if (p.type === "TRANSFER") throw new TRPCError({ code: "BAD_REQUEST", message: "Transfers cannot be reassigned" });
  if (toAccountId === fromAccountId) throw new TRPCError({ code: "BAD_REQUEST", message: "Already on this account" });
  if (!ownedAccountIds.has(toAccountId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Destination account not found" });
}

type FetchedParticular = {
  id: string; name: string; type: "INCOME" | "EXPENSE" | "TRANSFER";
  accountId: string; toAccountId: string | null;
  [key: string]: unknown;
};

export type ListAllRow = FetchedParticular & {
  accountName: string;
  direction: "OUT" | "IN";
  canEditItems: boolean;
};

/**
 * Flatten fetched particulars into display rows. Each row is tagged with the
 * account it displays under. Transfers whose destination is one of the user's
 * own accounts additionally emit a read-only IN echo on that to-account.
 * Pure — no Prisma, no clock.
 */
export function buildListAllRows(
  particulars: FetchedParticular[],
  accountMeta: Map<string, { name: string; canEditItems: boolean }>,
): ListAllRow[] {
  const rows: ListAllRow[] = [];
  for (const p of particulars) {
    const from = accountMeta.get(p.accountId);
    if (from) {
      rows.push({ ...p, accountName: from.name, direction: "OUT", canEditItems: from.canEditItems });
    }
    if (p.type === "TRANSFER" && p.toAccountId) {
      const to = accountMeta.get(p.toAccountId);
      if (to) {
        rows.push({ ...p, accountId: p.toAccountId, accountName: to.name, direction: "IN", canEditItems: false });
      }
    }
  }
  return rows;
}

export const particularRouter = router({
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.prisma.accountMembership.findMany({
      where: { userId: ctx.user.id, account: { closedAt: null } },
      select: { canEditItems: true, account: { select: { id: true, name: true } } },
    });
    const accountMeta = new Map(
      memberships.map((m) => [m.account.id, { name: m.account.name, canEditItems: m.canEditItems }]),
    );
    const particulars = await ctx.prisma.particular.findMany({
      where: { accountId: { in: [...accountMeta.keys()] } },
      include: { overrides: true },
      orderBy: { startDate: "asc" },
    });
    return buildListAllRows(particulars as never, accountMeta);
  }),

  list: accountProcedure.query(({ ctx }) =>
    ctx.prisma.particular.findMany({
      where: { accountId: ctx.account.id }, include: { overrides: true }, orderBy: { startDate: "asc" },
    })),

  create: accountProcedure.input(particularInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "editItems");
    const { accountId: _accountId, toAccountId, ...rest } = input as typeof input & { accountId?: string };
    const owned = await ownedAccountIds(ctx.prisma, ctx.user.id);
    assertTransferShape({ type: input.type, accountId: ctx.account.id, toAccountId: toAccountId ?? null }, owned);
    const created = await ctx.prisma.particular.create({
      data: {
        ...rest, category: rest.category ?? null, accountId: ctx.account.id,
        toAccountId: input.type === "TRANSFER" ? toAccountId! : null,
      },
    });
    await syncAccountCategories(ctx.prisma, ctx.account.id);
    return created;
  }),

  update: accountProcedure.input(particularInput.and(z.object({ id: z.string() })))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.membership, "editItems");
      const { id, accountId: _a, toAccountId, ...data } = input as typeof input & { accountId?: string };
      const ownedRow = await ctx.prisma.particular.findFirst({ where: { id, accountId: ctx.account.id } });
      if (!ownedRow) throw new TRPCError({ code: "NOT_FOUND" });
      const ownedIds = await ownedAccountIds(ctx.prisma, ctx.user.id);
      assertTransferShape({ type: input.type, accountId: ctx.account.id, toAccountId: toAccountId ?? null }, ownedIds);
      const updated = await ctx.prisma.particular.update({
        where: { id },
        data: { ...data, category: data.category ?? null, toAccountId: input.type === "TRANSFER" ? toAccountId! : null },
      });
      await syncAccountCategories(ctx.prisma, ctx.account.id);
      return updated;
    }),

  reassignAccount: accountProcedure.input(z.object({ id: z.string(), toAccountId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.membership, "editItems");
      const p = await ctx.prisma.particular.findFirst({ where: { id: input.id, accountId: ctx.account.id } });
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      const owned = await ownedAccountIds(ctx.prisma, ctx.user.id);
      assertReassignAllowed(p, ctx.account.id, input.toAccountId, owned);
      const updated = await ctx.prisma.$transaction(async (tx) => {
        await tx.particularOverride.deleteMany({ where: { particularId: input.id } });
        return tx.particular.update({ where: { id: input.id }, data: { accountId: input.toAccountId } });
      });
      await syncAccountCategories(ctx.prisma, ctx.account.id);
      await syncAccountCategories(ctx.prisma, input.toAccountId);
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
