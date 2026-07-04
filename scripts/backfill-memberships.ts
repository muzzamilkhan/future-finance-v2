import { config as loadEnv } from "dotenv";
loadEnv();

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Read legacy data via raw SQL (columns may not exist post-push; guarded).
  let legacy: { id: string; ownerId: string; categories: string }[] = [];
  try {
    legacy = await prisma.$queryRawUnsafe(
      `SELECT fa.id, fa."ownerId", u.categories
       FROM "FinanceAccount" fa JOIN "User" u ON u.id = fa."ownerId"`,
    );
  } catch {
    console.log("Legacy columns absent — nothing to backfill.");
    return;
  }
  for (const row of legacy) {
    const existing = await prisma.accountMembership.findUnique({
      where: { userId_accountId: { userId: row.ownerId, accountId: row.id } },
    });
    if (existing) continue;
    await prisma.accountMembership.create({
      data: {
        userId: row.ownerId, accountId: row.id, role: "OWNER", isDefault: true,
        canEditItems: true, canEditOverrides: true, canUpdateBalance: true,
      },
    });
    await prisma.financeAccount.update({
      where: { id: row.id }, data: { categories: row.categories ?? "" },
    });
    console.log(`Backfilled membership for account ${row.id}`);
  }
}
main().finally(() => prisma.$disconnect());
