import { router, accountProcedure } from "../trpc";
import { parseCategories } from "@/lib/budget/category";

export const categoryRouter = router({
  list: accountProcedure.query(({ ctx }) => parseCategories(ctx.account.categories ?? "")),
});
