import { z } from "zod";
import { router, accountProcedure, protectedProcedure, ensureBootstrapAccount } from "../trpc";

/** The replay window start: earliest account anchor, clamped to viewStart. */
export function combinedWindowStart(
  accounts: { balanceUpdatedAt: Date }[],
  viewStart: Date,
): Date {
  const earliest = accounts.reduce(
    (min, a) => (a.balanceUpdatedAt < min ? a.balanceUpdatedAt : min),
    viewStart,
  );
  return earliest < viewStart ? earliest : viewStart;
}

/** Map a FinanceAccount row to the engine-account payload shape. */
export function toAccountPayload(a: {
  id: string; name: string; type: "DEBIT" | "CREDIT";
  currentBalance: unknown; balanceUpdatedAt: Date; creditLimit: unknown;
}) {
  return {
    id: a.id, name: a.name, type: a.type,
    currentBalance: Number(a.currentBalance), balanceUpdatedAt: a.balanceUpdatedAt,
    creditLimit: a.creditLimit === null ? null : Number(a.creditLimit),
  };
}

/** Distinct userIds of the OWNER membership across the given membership rows. Pure, testable. */
export function ownerUserIds(
  memberships: { userId: string; role: "OWNER" | "MEMBER" }[],
): string[] {
  return [...new Set(memberships.filter((m) => m.role === "OWNER").map((m) => m.userId))];
}

export const forecastRouter = router({
  // Returns raw data for the FULL replay window [balanceUpdatedAt .. viewEnd].
  getData: accountProcedure
    .input(z.object({ viewStart: z.coerce.date(), viewEnd: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const a = ctx.account;
      const windowStart = a.balanceUpdatedAt < input.viewStart ? a.balanceUpdatedAt : input.viewStart;

      const particulars = await ctx.prisma.particular.findMany({
        where: {
          accountId: a.id,
          OR: [
            { frequency: "ONCE_OFF", startDate: { gte: windowStart, lte: input.viewEnd } },
            { frequency: { not: "ONCE_OFF" }, startDate: { lte: input.viewEnd },
              OR: [{ endDate: null }, { endDate: { gte: windowStart } }] },
          ],
        },
        include: { overrides: { where: { originalDate: { gte: windowStart, lte: input.viewEnd } } } },
        orderBy: { startDate: "asc" },
      });

      const ownerMemberships = await ctx.prisma.accountMembership.findMany({
        where: { accountId: a.id, role: "OWNER" },
        select: { userId: true, role: true },
      });
      const ownerIds = ownerUserIds(ownerMemberships);

      const holidays = await ctx.prisma.holiday.findMany({
        where: {
          userId: { in: ownerIds },
          OR: [
            { isRecurring: false, date: { gte: windowStart, lte: input.viewEnd } },
            { isRecurring: true },
          ],
        },
        orderBy: { date: "asc" },
      });

      return {
        account: { currentBalance: Number(a.currentBalance), balanceUpdatedAt: a.balanceUpdatedAt },
        particulars, holidays,
      };
    }),

  getCombined: protectedProcedure
    .input(z.object({ viewStart: z.coerce.date(), viewEnd: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      await ensureBootstrapAccount(ctx.user.id);
      const memberships = await ctx.prisma.accountMembership.findMany({
        where: { userId: ctx.user.id, account: { closedAt: null } },
        include: { account: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });
      const accounts = memberships.map((m) => m.account);
      const accountIds = accounts.map((a) => a.id);
      const windowStart = combinedWindowStart(accounts, input.viewStart);

      const particulars = await ctx.prisma.particular.findMany({
        where: {
          accountId: { in: accountIds },
          OR: [
            { frequency: "ONCE_OFF", startDate: { gte: windowStart, lte: input.viewEnd } },
            { frequency: { not: "ONCE_OFF" }, startDate: { lte: input.viewEnd },
              OR: [{ endDate: null }, { endDate: { gte: windowStart } }] },
          ],
        },
        include: { overrides: { where: { originalDate: { gte: windowStart, lte: input.viewEnd } } } },
        orderBy: { startDate: "asc" },
      });

      const holidays = await ctx.prisma.holiday.findMany({
        where: {
          accountId: { in: accountIds },
          OR: [
            { isRecurring: false, date: { gte: windowStart, lte: input.viewEnd } },
            { isRecurring: true },
          ],
        },
        orderBy: { date: "asc" },
      });

      return { accounts: accounts.map(toAccountPayload), particulars, holidays };
    }),
});
