import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, accountProcedure, ensureBootstrapAccount } from "../trpc";
import { assertCan } from "../permissions";
import { pickNextDefault } from "../defaultAccount";
import { updateBalanceInput, createAccountInput, createCreditAccountInput, updateAccountInput } from "@/lib/schemas";
import { money } from "../encryption/fields";

/** Prisma `data` for creating a credit account. Outstanding is entered positive (amount owed); stored negative. */
export function creditAccountCreateData(input: { name: string; creditLimit: number; outstanding: number }) {
  return {
    name: input.name,
    type: "CREDIT" as const,
    creditLimit: money(input.creditLimit),
    currentBalance: money(-input.outstanding),
    balanceUpdatedAt: new Date(),
  };
}

export function mapMembershipToListItem(m: {
  role: "OWNER" | "MEMBER"; isDefault: boolean;
  canEditItems: boolean; canEditOverrides: boolean; canUpdateBalance: boolean;
  account: { id: string; name: string; currentBalance: unknown; balanceUpdatedAt: Date; type: "DEBIT" | "CREDIT"; creditLimit: unknown };
}) {
  return {
    id: m.account.id, name: m.account.name,
    currentBalance: Number(m.account.currentBalance), balanceUpdatedAt: m.account.balanceUpdatedAt,
    type: m.account.type,
    creditLimit: m.account.creditLimit === null ? null : Number(m.account.creditLimit),
    role: m.role, isDefault: m.isDefault,
    canEditItems: m.canEditItems, canEditOverrides: m.canEditOverrides,
    canUpdateBalance: m.canUpdateBalance,
  };
}

export const accountRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    // Bootstraps a first account when there is none, and is memoised per request —
    // the dashboard batches this with forecast.getCombined, which needs the same list.
    const memberships = await ctx.openMemberships();
    return memberships.map(mapMembershipToListItem);
  }),

  create: protectedProcedure.input(createAccountInput)
    .mutation(async ({ ctx, input }) => {
      const count = await ctx.prisma.accountMembership.count({ where: { userId: ctx.user.id } });
      const account = await ctx.prisma.financeAccount.create({
        data: { name: input.name, currentBalance: money(input.initialBalance), balanceUpdatedAt: new Date() },
      });
      await ctx.prisma.accountMembership.create({
        data: {
          userId: ctx.user.id, accountId: account.id, role: "OWNER", isDefault: count === 0,
          canEditItems: true, canEditOverrides: true, canUpdateBalance: true,
        },
      });
      return { id: account.id };
    }),

  setDefault: accountProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.$transaction([
      ctx.prisma.accountMembership.updateMany({ where: { userId: ctx.user.id, isDefault: true }, data: { isDefault: false } }),
      ctx.prisma.accountMembership.update({ where: { userId_accountId: { userId: ctx.user.id, accountId: ctx.account.id } }, data: { isDefault: true } }),
    ]);
    return { ok: true };
  }),

  close: accountProcedure.mutation(async ({ ctx }) => {
    if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can close an account" });
    const memberships = await ctx.prisma.accountMembership.findMany({
      where: { userId: ctx.user.id }, include: { account: { select: { closedAt: true } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    const nextDefaultId = pickNextDefault(
      memberships.map((m) => ({ accountId: m.accountId, isDefault: m.isDefault, closedAt: m.account.closedAt })),
      ctx.account.id,
    );
    await ctx.prisma.$transaction(async (tx) => {
      await tx.financeAccount.update({ where: { id: ctx.account.id }, data: { closedAt: new Date() } });
      if (ctx.membership.isDefault) {
        await tx.accountMembership.update({
          where: { userId_accountId: { userId: ctx.user.id, accountId: ctx.account.id } }, data: { isDefault: false },
        });
        if (nextDefaultId) {
          await tx.accountMembership.update({
            where: { userId_accountId: { userId: ctx.user.id, accountId: nextDefaultId } }, data: { isDefault: true },
          });
        }
      }
    });
    return { ok: true };
  }),

  leave: accountProcedure.mutation(async ({ ctx }) => {
    if (ctx.membership.role === "OWNER") throw new TRPCError({ code: "BAD_REQUEST", message: "Owner cannot leave; close the account instead" });
    await ctx.prisma.accountMembership.delete({
      where: { userId_accountId: { userId: ctx.user.id, accountId: ctx.account.id } },
    });
    return { ok: true };
  }),

  updateBalance: accountProcedure.input(updateBalanceInput).mutation(async ({ ctx, input }) => {
    assertCan(ctx.membership, "updateBalance");
    return ctx.prisma.financeAccount.update({
      where: { id: ctx.account.id }, data: { currentBalance: money(input.balance), balanceUpdatedAt: new Date() },
    });
  }),

  members: accountProcedure.query(async ({ ctx }) => {
    if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN" });
    const ms = await ctx.prisma.accountMembership.findMany({
      where: { accountId: ctx.account.id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    return ms.map((m) => ({
      userId: m.userId, name: m.user.name, email: m.user.email, role: m.role,
      canEditItems: m.canEditItems, canEditOverrides: m.canEditOverrides,
      canUpdateBalance: m.canUpdateBalance,
    }));
  }),

  updateMemberPerms: accountProcedure.input(z.object({
    userId: z.string(),
    canEditItems: z.boolean(),
    canEditOverrides: z.boolean(),
    canUpdateBalance: z.boolean(),
  })).mutation(async ({ ctx, input }) => {
    if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN" });
    if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot change owner perms" });
    await ctx.prisma.accountMembership.update({
      where: { userId_accountId: { userId: input.userId, accountId: ctx.account.id } },
      data: {
        canEditItems: input.canEditItems, canEditOverrides: input.canEditOverrides,
        canUpdateBalance: input.canUpdateBalance,
      },
    });
    return { ok: true };
  }),

  removeMember: accountProcedure.input(z.object({ userId: z.string() })).mutation(async ({ ctx, input }) => {
    if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN" });
    if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Owner cannot remove self" });
    const res = await ctx.prisma.accountMembership.deleteMany({
      where: { userId: input.userId, accountId: ctx.account.id, role: "MEMBER" },
    });
    if (res.count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "No such member to remove" });
    return { ok: true };
  }),

  createCredit: protectedProcedure.input(createCreditAccountInput).mutation(async ({ ctx, input }) => {
    await ensureBootstrapAccount(ctx.user.id);
    const account = await ctx.prisma.financeAccount.create({ data: creditAccountCreateData(input) });
    await ctx.prisma.accountMembership.create({
      data: {
        userId: ctx.user.id, accountId: account.id, role: "OWNER", isDefault: false,
        canEditItems: true, canEditOverrides: true, canUpdateBalance: true,
      },
    });
    return { id: account.id };
  }),

  update: accountProcedure.input(updateAccountInput).mutation(async ({ ctx, input }) => {
    if (ctx.membership.role !== "OWNER") throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can edit an account" });
    if (input.creditLimit !== undefined && ctx.account.type !== "CREDIT") throw new TRPCError({ code: "BAD_REQUEST", message: "Not a credit account" });
    return ctx.prisma.financeAccount.update({
      where: { id: ctx.account.id },
      data: {
        name: input.name,
        ...(input.creditLimit !== undefined ? { creditLimit: money(input.creditLimit) } : {}),
        ...(input.balance !== undefined ? { currentBalance: money(input.balance), balanceUpdatedAt: new Date() } : {}),
      },
    });
  }),
});
