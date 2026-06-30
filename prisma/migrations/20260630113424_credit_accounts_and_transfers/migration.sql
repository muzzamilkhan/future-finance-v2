-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('DEBIT', 'CREDIT');

-- AlterEnum
ALTER TYPE "ParticularType" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "FinanceAccount" ADD COLUMN     "creditLimit" DECIMAL(15,2),
ADD COLUMN     "type" "AccountType" NOT NULL DEFAULT 'DEBIT';

-- AlterTable
ALTER TABLE "Particular" ADD COLUMN     "toAccountId" TEXT;

-- CreateIndex
CREATE INDEX "Particular_toAccountId_idx" ON "Particular"("toAccountId");

-- AddForeignKey
ALTER TABLE "Particular" ADD CONSTRAINT "Particular_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
