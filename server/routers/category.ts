import { router, accountProcedure, protectedProcedure } from "../trpc";
import { parseCategories } from "@/lib/spending/category";

export const categoryRouter = router({
  list: accountProcedure.query(({ ctx }) => parseCategories(ctx.account.categories ?? "")),

  // Union of categories across every account the user can see (deduped, sorted).
  // Used by the all-accounts spending view.
  listAll: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.prisma.accountMembership.findMany({
      where: { userId: ctx.user.id, account: { closedAt: null } },
      select: { account: { select: { categories: true } } },
    });
    const csv = memberships.map((m) => m.account.categories ?? "").join(",");
    return parseCategories(csv);
  }),
});
