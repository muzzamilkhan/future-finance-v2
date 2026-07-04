/*
  Warnings:

  - You are about to drop the column `accountId` on the `Holiday` table. All the data in this column will be lost.
  - You are about to drop the column `canEditHolidays` on the `AccountMembership` table. All the data in this column will be lost.
  - You are about to drop the column `canEditHolidays` on the `ShareInvite` table. All the data in this column will be lost.
  - A unique constraint covering the columns `[userId,name,source]` on the table `Holiday` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Holiday` table without a default value. This is required to change the column type `public."Holiday"."accountId"` to `public."Holiday"."userId"`.

*/
-- DropForeignKey
ALTER TABLE "Holiday" DROP CONSTRAINT "Holiday_accountId_fkey";

-- DropIndex
DROP INDEX "Holiday_accountId_name_source_key";

-- Holidays are re-keyed from account to user. The old account->owner mapping is not
-- available in this migration, so existing rows cannot be re-keyed and are cleared
-- (data wipe is approved, pre-production). Explicit so the NOT NULL add below is safe
-- whether this runs via `migrate reset` or `migrate deploy` on a non-empty table.
DELETE FROM "Holiday";

-- AlterTable
ALTER TABLE "Holiday" DROP COLUMN "accountId",
ADD COLUMN "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "AccountMembership" DROP COLUMN "canEditHolidays";

-- AlterTable
ALTER TABLE "ShareInvite" DROP COLUMN "canEditHolidays";

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_userId_name_source_key" ON "Holiday"("userId", "name", "source");

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
