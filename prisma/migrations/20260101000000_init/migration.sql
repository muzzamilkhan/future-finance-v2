-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "HolidaySource" AS ENUM ('IMPORTED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ParticularType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('ONCE_OFF', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "BusinessDayAdjustment" AS ENUM ('NONE', 'NEXT_BUSINESS_DAY', 'PREVIOUS_BUSINESS_DAY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "FinanceAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My Account',
    "currentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "balanceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categories" TEXT NOT NULL DEFAULT '',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "canEditItems" BOOLEAN NOT NULL DEFAULT false,
    "canEditOverrides" BOOLEAN NOT NULL DEFAULT false,
    "canEditHolidays" BOOLEAN NOT NULL DEFAULT false,
    "canUpdateBalance" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareInvite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
    "canEditItems" BOOLEAN NOT NULL DEFAULT false,
    "canEditOverrides" BOOLEAN NOT NULL DEFAULT false,
    "canEditHolidays" BOOLEAN NOT NULL DEFAULT false,
    "canUpdateBalance" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Particular" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "type" "ParticularType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'ONCE_OFF',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isCritical" BOOLEAN NOT NULL DEFAULT true,
    "isFixed" BOOLEAN NOT NULL DEFAULT true,
    "businessDayAdjustment" "BusinessDayAdjustment" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Particular_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticularOverride" (
    "id" TEXT NOT NULL,
    "particularId" TEXT NOT NULL,
    "originalDate" DATE NOT NULL,
    "overriddenDate" DATE,
    "overriddenAmount" DECIMAL(15,2),
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParticularOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "source" "HolidaySource" NOT NULL DEFAULT 'CUSTOM',

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "AccountMembership_accountId_idx" ON "AccountMembership"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMembership_userId_accountId_key" ON "AccountMembership"("userId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareInvite_token_key" ON "ShareInvite"("token");

-- CreateIndex
CREATE INDEX "ShareInvite_accountId_idx" ON "ShareInvite"("accountId");

-- CreateIndex
CREATE INDEX "Particular_accountId_startDate_endDate_idx" ON "Particular"("accountId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "ParticularOverride_particularId_originalDate_key" ON "ParticularOverride"("particularId", "originalDate");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_accountId_name_source_key" ON "Holiday"("accountId", "name", "source");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountMembership" ADD CONSTRAINT "AccountMembership_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareInvite" ADD CONSTRAINT "ShareInvite_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Particular" ADD CONSTRAINT "Particular_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticularOverride" ADD CONSTRAINT "ParticularOverride_particularId_fkey" FOREIGN KEY ("particularId") REFERENCES "Particular"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
