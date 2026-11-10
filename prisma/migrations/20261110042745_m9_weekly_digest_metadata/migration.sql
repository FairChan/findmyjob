-- CreateEnum
CREATE TYPE "WeeklyDigestKind" AS ENUM ('STUDENT_JOBS', 'EMPLOYER_TALENTS');

-- CreateEnum
CREATE TYPE "WeeklyDigestState" AS ENUM ('QUEUED', 'PREPARING', 'SENDING', 'SENT', 'RETRYABLE', 'SKIPPED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "WeeklyDigestDelivery" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" "WeeklyDigestKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "weekKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "state" "WeeklyDigestState" NOT NULL DEFAULT 'QUEUED',
    "marketingGrantId" TEXT NOT NULL,
    "matchingGrantId" TEXT,
    "gateEpoch" TEXT NOT NULL,
    "matchingEpoch" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "candidateIds" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WeeklyDigestDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDigestDelivery_dedupeKey_key" ON "WeeklyDigestDelivery"("dedupeKey");

-- CreateIndex
CREATE INDEX "WeeklyDigestDelivery_state_nextAttemptAt_expiresAt_idx" ON "WeeklyDigestDelivery"("state", "nextAttemptAt", "expiresAt");

-- CreateIndex
CREATE INDEX "WeeklyDigestDelivery_userId_weekKey_idx" ON "WeeklyDigestDelivery"("userId", "weekKey");

-- CreateIndex
CREATE INDEX "WeeklyDigestDelivery_companyId_idx" ON "WeeklyDigestDelivery"("companyId");

-- AddForeignKey
ALTER TABLE "WeeklyDigestDelivery" ADD CONSTRAINT "WeeklyDigestDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDigestDelivery" ADD CONSTRAINT "WeeklyDigestDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeeklyDigestDelivery"
  ADD CONSTRAINT "WeeklyDigestDelivery_kind_company_check" CHECK (
    ("kind" = 'STUDENT_JOBS' AND "companyId" IS NULL AND "matchingGrantId" IS NOT NULL) OR
    ("kind" = 'EMPLOYER_TALENTS' AND "companyId" IS NOT NULL AND "matchingGrantId" IS NULL)),
  ADD CONSTRAINT "WeeklyDigestDelivery_attempts_check" CHECK ("attempts" BETWEEN 0 AND 3),
  ADD CONSTRAINT "WeeklyDigestDelivery_candidates_check" CHECK (
    jsonb_typeof("candidateIds") = 'array' AND jsonb_array_length("candidateIds") <= 5 AND
    NOT jsonb_path_exists("candidateIds", '$[*] ? (@.type() != "string")')),
  ADD CONSTRAINT "WeeklyDigestDelivery_week_check" CHECK ("weekKey" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
