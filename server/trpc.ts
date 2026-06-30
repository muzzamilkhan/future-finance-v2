import { initTRPC, TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import superjson from "superjson";
import { z } from "zod";
import { prisma } from "./db";
import { auth } from "./auth";

export async function createContext() {
  const session = await auth();
  const id = session?.user?.id;
  return { user: id ? { id } : null, prisma };
}
export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export async function resolveMembership(userId: string, accountId: string) {
  const membership = await prisma.accountMembership.findUnique({
    where: { userId_accountId: { userId, accountId } },
    include: { account: true },
  });
  if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
  if (membership.account.closedAt) throw new TRPCError({ code: "NOT_FOUND" });
  const { account, ...rest } = membership;
  return { account, membership: rest };
}

export async function ensureBootstrapAccount(userId: string) {
  // Look for an existing open-account membership first. This covers the normal path
  // (user already has at least one open account) without any extra count query.
  const existing = await prisma.accountMembership.findFirst({
    where: { userId, account: { closedAt: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { account: true },
  });
  if (existing) {
    const { account, ...rest } = existing;
    return { account, membership: rest };
  }

  // No open accounts — either brand-new user OR user who closed all their accounts.
  // Bootstrap: create a fresh account + OWNER membership.
  //
  // Race-safety note: two concurrent requests from the same new user could both see
  // no open accounts and each try to create. We catch P2002 (unique constraint on
  // [userId, accountId] from the membership create). Note that two concurrent
  // bootstraps create DIFFERENT accounts, so the unique constraint does NOT fully
  // serialize first-login — it primarily guards the membership-level collision.
  // The practical risk is a rare duplicate empty account on simultaneous first-login,
  // which is acceptable and self-correcting (user can close the extra).
  const account = await prisma.financeAccount.create({ data: { name: "My Account" } });
  try {
    const membership = await prisma.accountMembership.create({
      data: {
        userId, accountId: account.id, role: "OWNER", isDefault: true,
        canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      },
    });
    return { account, membership };
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Concurrent bootstrap won the race: clean up our orphan account, fall through
      // to return the winner's membership.
      await prisma.financeAccount.delete({ where: { id: account.id } }).catch(() => {/* best-effort */});
    } else {
      throw err;
    }
  }

  // Return the winning membership after losing a race.
  const m = await prisma.accountMembership.findFirst({
    where: { userId, account: { closedAt: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { account: true },
  });
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "No open accounts" });
  const { account: winnerAccount, ...rest } = m;
  return { account: winnerAccount, membership: rest };
}

export const accountProcedure = protectedProcedure
  .input(z.object({ accountId: z.string() }))
  .use(async ({ ctx, input, next }) => {
    const { account, membership } = await resolveMembership(ctx.user.id, (input as { accountId: string }).accountId);
    return next({ ctx: { ...ctx, account, membership } });
  });
