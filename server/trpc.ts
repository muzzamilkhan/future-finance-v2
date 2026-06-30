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
    const account = await prisma.financeAccount.create({ data: { name: "My Account" } });
    const membership = await prisma.accountMembership.create({
      data: {
        userId, accountId: account.id, role: "OWNER", isDefault: true,
        canEditItems: true, canEditOverrides: true, canEditHolidays: true, canUpdateBalance: true,
      },
    });
    return { account, membership };
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
