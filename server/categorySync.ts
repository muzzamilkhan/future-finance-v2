import type { PrismaClient } from "@prisma/client";
import { serializeCategories } from "@/lib/budget/category";

export function computeUserCategories(expenseCategories: (string | null)[]): string {
  return serializeCategories(
    expenseCategories.filter((c): c is string => !!c && c.trim() !== ""),
  );
}

export async function syncUserCategories(
  prisma: PrismaClient,
  userId: string,
  accountId: string,
): Promise<void> {
  const expenses = await prisma.particular.findMany({
    where: { accountId, type: "EXPENSE" },
    select: { category: true },
  });
  const categories = computeUserCategories(expenses.map((e) => e.category));
  await prisma.user.update({ where: { id: userId }, data: { categories } });
}
