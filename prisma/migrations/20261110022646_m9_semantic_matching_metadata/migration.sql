-- CreateEnum
CREATE TYPE "SemanticIndexKind" AS ENUM ('STUDENT', 'JOB');

-- CreateEnum
CREATE TYPE "SemanticIndexState" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "matchingRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SemanticIndex" (
    "id" TEXT NOT NULL,
    "studentId" TEXT,
    "jobId" TEXT,
    "kind" "SemanticIndexKind" NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "state" "SemanticIndexState" NOT NULL DEFAULT 'QUEUED',
    "sourceHash" VARCHAR(64) NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "configurationId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "gateEpoch" TEXT NOT NULL,
    "legalVersion" TEXT NOT NULL,
    "consentGrantId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "failureCode" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SemanticIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchingCorpusCursor" (
    "id" TEXT NOT NULL,
    "kind" "SemanticIndexKind" NOT NULL,
    "afterId" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MatchingCorpusCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SemanticIndex_studentId_key" ON "SemanticIndex"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticIndex_jobId_key" ON "SemanticIndex"("jobId");

-- CreateIndex
CREATE INDEX "SemanticIndex_state_nextAttemptAt_idx" ON "SemanticIndex"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SemanticIndex_state_leaseExpiresAt_idx" ON "SemanticIndex"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchingCorpusCursor_kind_key" ON "MatchingCorpusCursor"("kind");

-- AddForeignKey
ALTER TABLE "SemanticIndex" ADD CONSTRAINT "SemanticIndex_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticIndex" ADD CONSTRAINT "SemanticIndex_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ordinary metadata constraints: no pgvector type or extension dependency.
ALTER TABLE "SemanticIndex" ADD CONSTRAINT "SemanticIndex_owner_kind_check" CHECK (
  ("kind" = 'STUDENT' AND "studentId" IS NOT NULL AND "jobId" IS NULL AND "consentGrantId" IS NOT NULL)
  OR ("kind" = 'JOB' AND "jobId" IS NOT NULL AND "studentId" IS NULL AND "consentGrantId" IS NULL)
);
ALTER TABLE "SemanticIndex" ADD CONSTRAINT "SemanticIndex_revision_check"
  CHECK ("generation" >= 1 AND "sourceRevision" >= 0 AND "attempts" BETWEEN 0 AND 3);
ALTER TABLE "SemanticIndex" ADD CONSTRAINT "SemanticIndex_source_hash_check"
  CHECK ("sourceHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "SemanticIndex" ADD CONSTRAINT "SemanticIndex_failure_code_check" CHECK (
  "failureCode" IS NULL OR "failureCode" IN (
    'AUTHORIZATION_CHANGED','SOURCE_CHANGED','CONFIGURATION_CHANGED','SOURCE_UNAVAILABLE',
    'STORE_UNAVAILABLE','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','OUTPUT_INVALID','ATTEMPTS_EXHAUSTED','QUEUE_UNAVAILABLE'
  )
);
ALTER TABLE "Job" ADD CONSTRAINT "Job_matching_revision_check" CHECK ("matchingRevision" >= 0);
ALTER TABLE "SemanticIndex" ADD CONSTRAINT "SemanticIndex_lease_pair_check" CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL));
