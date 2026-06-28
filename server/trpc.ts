import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
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

export async function resolveAccount(userId: string) {
  const existing = await prisma.financeAccount.findUnique({ where: { ownerId: userId } });
  if (existing) return existing;
  return prisma.financeAccount.create({
    data: { ownerId: userId, name: "My Account", currentBalance: 0 },
  });
}
