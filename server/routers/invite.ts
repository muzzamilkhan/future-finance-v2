import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, accountProcedure } from "../trpc";
import { assertInviteUsable, generateToken } from "../invites";

const permInput = z.object({
  role: z.enum(["MEMBER"]).default("MEMBER"),
  canEditItems: z.boolean().default(false),
  canEditOverrides: z.boolean().default(false),
  canEditHolidays: z.boolean().default(false),
  canUpdateBalance: z.boolean().default(false),
  expiresAt: z.coerce.date().optional(),
});

export function permsFromInvite(i: {
  role: "OWNER" | "MEMBER";
  canEditItems: boolean;
  canEditOverrides: boolean;
  canEditHolidays: boolean;
  canUpdateBalance: boolean;
}) {
  return {
    role: i.role,
    canEditItems: i.canEditItems,
    canEditOverrides: i.canEditOverrides,
    canEditHolidays: i.canEditHolidays,
    canUpdateBalance: i.canUpdateBalance,
  };
}

export const inviteRouter = router({
  create: accountProcedure.input(permInput).mutation(async ({ ctx, input }) => {
    if (ctx.membership.role !== "OWNER") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can share" });
    }
    const token = generateToken();
    await ctx.prisma.shareInvite.create({
      data: {
        token,
        accountId: ctx.account.id,
        createdByUserId: ctx.user.id,
        role: "MEMBER",
        canEditItems: input.canEditItems,
        canEditOverrides: input.canEditOverrides,
        canEditHolidays: input.canEditHolidays,
        canUpdateBalance: input.canUpdateBalance,
        expiresAt: input.expiresAt,
      },
    });
    return { token, url: `/invite/${token}` };
  }),

  get: protectedProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const invite = await ctx.prisma.shareInvite.findUnique({
      where: { token: input.token },
      include: { account: true },
    });
    if (!invite) throw new TRPCError({ code: "NOT_FOUND" });
    assertInviteUsable(invite, new Date());
    const sharer = await ctx.prisma.user.findUnique({
      where: { id: invite.createdByUserId },
      select: { name: true, email: true },
    });
    return {
      accountName: invite.account.name,
      sharedByName: sharer?.name ?? sharer?.email ?? "Someone",
      perms: permsFromInvite(invite),
    };
  }),

  accept: protectedProcedure.input(z.object({ token: z.string() })).mutation(async ({ ctx, input }) => {
    const invite = await ctx.prisma.shareInvite.findUnique({ where: { token: input.token } });
    if (!invite) throw new TRPCError({ code: "NOT_FOUND" });
    assertInviteUsable(invite, new Date());
    await ctx.prisma.$transaction(async (tx) => {
      const existing = await tx.accountMembership.findUnique({
        where: { userId_accountId: { userId: ctx.user.id, accountId: invite.accountId } },
      });
      if (!existing) {
        await tx.accountMembership.create({
          data: {
            userId: ctx.user.id,
            accountId: invite.accountId,
            ...permsFromInvite(invite),
          },
        });
      }
      await tx.shareInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    });
    return { accountId: invite.accountId };
  }),
});
