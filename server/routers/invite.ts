import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, accountProcedure } from "../trpc";
import { assertInviteUsable, generateToken } from "../invites";

const permInput = z.object({
  role: z.enum(["MEMBER"]).default("MEMBER"),
  canEditItems: z.boolean().default(false),
  canEditOverrides: z.boolean().default(false),
  canUpdateBalance: z.boolean().default(false),
  expiresAt: z.coerce.date().optional(),
});

export function permsFromInvite(i: {
  role: "OWNER" | "MEMBER";
  canEditItems: boolean;
  canEditOverrides: boolean;
  canUpdateBalance: boolean;
}) {
  return {
    role: i.role,
    canEditItems: i.canEditItems,
    canEditOverrides: i.canEditOverrides,
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
        canUpdateBalance: input.canUpdateBalance,
        expiresAt: input.expiresAt,
      },
    });
    return { token, url: `/invite/${token}` };
  }),

  get: protectedProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const invite = await ctx.prisma.shareInvite.findUnique({
      where: { token: input.token },
      include: { account: { select: { name: true } } },
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
    return ctx.prisma.$transaction(async (tx) => {
      // Atomic single-use consume: only the first concurrent caller flips acceptedAt from null.
      const consumed = await tx.shareInvite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });

      // Did the caller already have a membership on this account? (idempotent revisit / owner self-accept)
      const existing = await tx.accountMembership.findUnique({
        where: { userId_accountId: { userId: ctx.user.id, accountId: invite.accountId } },
      });

      if (consumed.count === 0) {
        // We lost the consume race (or the link was already used). That's fine ONLY if this
        // user already belongs to the account (idempotent revisit). Otherwise the link is spent.
        if (existing) return { accountId: invite.accountId };
        throw new TRPCError({ code: "BAD_REQUEST", message: "This invite link has already been used" });
      }

      // We won the consume. Create the membership unless the user already has one
      // (e.g. owner accepting their own invite) — never overwrite existing perms.
      if (!existing) {
        await tx.accountMembership.create({
          data: { userId: ctx.user.id, accountId: invite.accountId, ...permsFromInvite(invite) },
        });
      }
      return { accountId: invite.accountId };
    });
  }),
});
