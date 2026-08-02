import { serializeCategories } from "@/lib/spending/category";

/**
 * Structural subset of the Prisma client. Typed structurally rather than as
 * `PrismaClient` because the app's client is `$extends`-wrapped for field
 * encryption, which is not assignable to the bare client type.
 */
type CategorySyncDb = {
  particular: {
    findMany(args: {
      where: { accountId: string; type: "EXPENSE"; frequency: { not: "ONCE_OFF" } };
      select: { category: true };
    }): Promise<{ category: string | null }[]>;
  };
  financeAccount: {
    update(args: { where: { id: string }; data: { categories: string } }): Promise<unknown>;
  };
};

export function computeUserCategories(expenseCategories: (string | null)[]): string {
  return serializeCategories(
    expenseCategories.filter((c): c is string => !!c && c.trim() !== ""),
  );
}

export async function syncAccountCategories(prisma: CategorySyncDb, accountId: string): Promise<void> {
  // Categories are strictly for recurring expenses — exclude once-off items.
  const expenses = await prisma.particular.findMany({
    where: { accountId, type: "EXPENSE", frequency: { not: "ONCE_OFF" } },
    select: { category: true },
  });
  const categories = computeUserCategories(expenses.map((e) => e.category));
  await prisma.financeAccount.update({ where: { id: accountId }, data: { categories } });
}
