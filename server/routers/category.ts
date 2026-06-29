import { router, protectedProcedure } from "../trpc";
import { parseCategories } from "@/lib/budget/category";

export const categoryRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { categories: true },
    });
    return parseCategories(user?.categories ?? "");
  }),
});
