-- Widen the encrypted columns from DECIMAL to TEXT so they can hold AES-GCM
-- ciphertext. Existing numeric values are cast to their plain string form; the
-- decrypt path passes non-envelope values through unchanged, so the app keeps
-- working until `scripts/encrypt-existing-data.ts` backfills them.

-- FinanceAccount
ALTER TABLE "FinanceAccount" ALTER COLUMN "currentBalance" DROP DEFAULT;
ALTER TABLE "FinanceAccount" ALTER COLUMN "currentBalance" TYPE TEXT USING "currentBalance"::TEXT;
ALTER TABLE "FinanceAccount" ALTER COLUMN "currentBalance" SET DEFAULT '0';
ALTER TABLE "FinanceAccount" ALTER COLUMN "creditLimit" TYPE TEXT USING "creditLimit"::TEXT;

-- Particular
ALTER TABLE "Particular" ALTER COLUMN "amount" TYPE TEXT USING "amount"::TEXT;

-- ParticularOverride
ALTER TABLE "ParticularOverride" ALTER COLUMN "overriddenAmount" TYPE TEXT USING "overriddenAmount"::TEXT;

-- Debt
ALTER TABLE "Debt" ALTER COLUMN "balance" TYPE TEXT USING "balance"::TEXT;
ALTER TABLE "Debt" ALTER COLUMN "apr" TYPE TEXT USING "apr"::TEXT;
ALTER TABLE "Debt" ALTER COLUMN "minPayment" TYPE TEXT USING "minPayment"::TEXT;
