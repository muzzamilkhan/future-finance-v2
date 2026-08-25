import { initTRPC, TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import superjson from "superjson";
import { z } from "zod";
import { prisma } from "./db";
import { auth } from "./auth";

export async function createContext() {
  const session = await auth();
  const id = session?.user?.id;
  const user = id ? { id } : null;

  // A batched tRPC request runs every procedure in the batch against ONE context.
  // The dashboard's opening batch asks for forecast.getCombined AND account.list,
  // which both need the same open-membership list; memoising the promise here
  // collapses that into a single query per HTTP request instead of one per procedure.
  let memberships: ReturnType<typeof loadOpenMemberships> | null = null;
  const openMemberships = () => {
    if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
    return (memberships ??= loadOpenMemberships(user.id));
  };

  return { user, prisma, openMemberships };
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

// Best-default-first ordering, shared by every "open memberships" lookup below.
// Inlined rather than hoisted into a const: Prisma infers the `include` shape from
// the literal at each call site, and a shared `as const` object erases that.
/**
 * Every open-account membership for the user, best-default first, creating a first
 * account if they have none.
 *
 * This is the single entry point for "which accounts can this user see?". It exists
 * because callers used to run `ensureBootstrapAccount()` and then immediately run
 * the same `findMany` again — and the bootstrap check's `findFirst` is just the
 * first row of that `findMany`. That was one wasted round trip per call, on the
 * dashboard's cold path.
 */
export async function loadOpenMemberships(userId: string) {
  const memberships = await prisma.accountMembership.findMany({
    where: { userId, account: { closedAt: null } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { account: true },
  });
  if (memberships.length > 0) return memberships;

  const { account, membership } = await bootstrapAccount(userId);
  return [{ ...membership, account }];
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
  return bootstrapAccount(userId);
}

/**
 * Create a fresh account + OWNER membership for a user with no open accounts —
 * either brand-new, or one who closed all of theirs.
 *
 * Race-safety note: two concurrent requests from the same new user could both see
 * no open accounts and each try to create. We catch P2002 (unique constraint on
 * [userId, accountId] from the membership create). Note that two concurrent
 * bootstraps create DIFFERENT accounts, so the unique constraint does NOT fully
 * serialize first-login — it primarily guards the membership-level collision.
 * The practical risk is a rare duplicate empty account on simultaneous first-login,
 * which is acceptable and self-correcting (user can close the extra).
 */
async function bootstrapAccount(userId: string) {
  const account = await prisma.financeAccount.create({ data: { name: "My Account" } });
  try {
    const membership = await prisma.accountMembership.create({
      data: {
        userId, accountId: account.id, role: "OWNER", isDefault: true,
        canEditItems: true, canEditOverrides: true, canUpdateBalance: true,
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
