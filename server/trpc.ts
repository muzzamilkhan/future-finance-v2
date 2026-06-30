import { initTRPC, TRPCError } from "@trpc/server";
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
  const count = await prisma.accountMembership.count({ where: { userId } });
  if (count === 0) {
    // Race-safe bootstrap: two simultaneous first-logins from the same new user could
    // both see count===0 and each try to create an account + membership. We catch the
    // unique-constraint violation on (userId, accountId) from the membership create
    // (Prisma error code P2002), delete the orphan account we just created, and fall
    // through to the findFirst below to return the winner's membership.
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
      // P2002 = unique constraint violation — another concurrent bootstrap won the race.
      // Clean up the orphan account we created, then fall through to return existing.
      const code = (err as { code?: string })?.code;
      if (code === "P2002") {
        await prisma.financeAccount.delete({ where: { id: account.id } }).catch(() => {/* best-effort */});
      } else {
        throw err;
      }
    }
  }
  const m = await prisma.accountMembership.findFirst({
    where: { userId, account: { closedAt: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { account: true },
  });
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "No open accounts" });
  const { account, ...rest } = m;
  return { account, membership: rest };
}

export const accountProcedure = protectedProcedure
  .input(z.object({ accountId: z.string() }))
  .use(async ({ ctx, input, next }) => {
    const { account, membership } = await resolveMembership(ctx.user.id, (input as { accountId: string }).accountId);
    return next({ ctx: { ...ctx, account, membership } });
  });
