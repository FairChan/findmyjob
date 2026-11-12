-- CreateEnum
CREATE TYPE "ResumeParseState" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "DataExportArtifactState" AS ENUM ('RESERVED', 'UPLOADING', 'UPLOADED', 'PUBLISHED', 'CLEANUP_REQUIRED', 'CLEANED');

-- CreateEnum
CREATE TYPE "DataExportUploadOutcome" AS ENUM ('NOT_STARTED', 'UNKNOWN', 'ACKNOWLEDGED');

-- AlterTable
ALTER TABLE "DataRequest" ADD COLUMN     "exportGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "exportLeaseExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "exportLeaseToken" TEXT;

-- AlterTable
ALTER TABLE "ResumeFile" ADD COLUMN     "contentSha256" VARCHAR(64);

-- AlterTable
ALTER TABLE "StudentProfile" ADD COLUMN     "editRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ResumeParseDraft" (
    "id" TEXT NOT NULL,
    "resumeId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "state" "ResumeParseState" NOT NULL DEFAULT 'QUEUED',
    "sourceStorageKey" TEXT NOT NULL,
    "sourceSha256" VARCHAR(64) NOT NULL,
    "consentGrantId" TEXT NOT NULL,
    "legalVersion" TEXT NOT NULL,
    "gateEpoch" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "promptVersion" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "responseModel" TEXT,
    "payload" JSONB,
    "failureCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "leaseToken" TEXT,
    "confirmationHash" VARCHAR(64),
    "appliedProfileRevision" INTEGER,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ResumeParseDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportArtifact" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "state" "DataExportArtifactState" NOT NULL DEFAULT 'RESERVED',
    "uploadOutcome" "DataExportUploadOutcome" NOT NULL DEFAULT 'NOT_STARTED',
    "publishedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "cleanupNextAt" TIMESTAMPTZ(3),
    "cleanupLeaseToken" TEXT,
    "cleanupLeaseExpiresAt" TIMESTAMPTZ(3),
    "lastDeleteAt" TIMESTAMPTZ(3),
    "cleanedAt" TIMESTAMPTZ(3),
    "notificationReservedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DataExportArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResumeParseDraft_resumeId_key" ON "ResumeParseDraft"("resumeId");

-- CreateIndex
CREATE INDEX "ResumeParseDraft_state_nextAttemptAt_idx" ON "ResumeParseDraft"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ResumeParseDraft_state_leaseExpiresAt_idx" ON "ResumeParseDraft"("state", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataExportArtifact_storageKey_key" ON "DataExportArtifact"("storageKey");

-- CreateIndex
CREATE INDEX "DataExportArtifact_userId_state_idx" ON "DataExportArtifact"("userId", "state");

-- CreateIndex
CREATE INDEX "DataExportArtifact_requestId_state_idx" ON "DataExportArtifact"("requestId", "state");

-- CreateIndex
CREATE INDEX "DataExportArtifact_state_leaseExpiresAt_idx" ON "DataExportArtifact"("state", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "DataExportArtifact_state_cleanupNextAt_idx" ON "DataExportArtifact"("state", "cleanupNextAt");

-- CreateIndex
CREATE INDEX "DataExportArtifact_state_expiresAt_idx" ON "DataExportArtifact"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataExportArtifact_requestId_generation_key" ON "DataExportArtifact"("requestId", "generation");

-- CreateIndex
CREATE INDEX "DataRequest_type_status_exportLeaseExpiresAt_idx" ON "DataRequest"("type", "status", "exportLeaseExpiresAt");

-- AddForeignKey
ALTER TABLE "ResumeParseDraft" ADD CONSTRAINT "ResumeParseDraft_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "ResumeFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_editRevision_nonnegative"
  CHECK ("editRevision" >= 0);
ALTER TABLE "ResumeFile" ADD CONSTRAINT "ResumeFile_contentSha256_valid"
  CHECK ("contentSha256" IS NULL OR "contentSha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE "ResumeParseDraft" ADD CONSTRAINT "ResumeParseDraft_generation_positive"
  CHECK (generation > 0);
ALTER TABLE "ResumeParseDraft" ADD CONSTRAINT "ResumeParseDraft_attempts_nonnegative"
  CHECK (attempts >= 0);
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_exportGeneration_nonnegative"
  CHECK ("exportGeneration" >= 0);
ALTER TABLE "DataExportArtifact" ADD CONSTRAINT "DataExportArtifact_generation_positive"
  CHECK (generation > 0);
ALTER TABLE "DataExportArtifact" ADD CONSTRAINT "DataExportArtifact_exact_key"
  CHECK ("storageKey" = 'exports/' || "userId" || '/' || "requestId" || '/' || id || '.zip');

CREATE FUNCTION enforce_data_export_artifact_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."requestId" IS DISTINCT FROM OLD."requestId" OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW."leaseToken" IS DISTINCT FROM OLD."leaseToken" OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey" THEN
    RAISE EXCEPTION 'Data export artifact identity is immutable';
  END IF;
  IF OLD.state = 'CLEANED' AND NEW.state <> 'CLEANED' THEN
    RAISE EXCEPTION 'Cleaned export cannot be reused';
  END IF;
  IF OLD.state = 'CLEANUP_REQUIRED' AND NEW.state NOT IN ('CLEANUP_REQUIRED', 'CLEANED') THEN
    RAISE EXCEPTION 'Cleanup export cannot be published';
  END IF;
  IF OLD."uploadOutcome" = 'ACKNOWLEDGED' AND NEW."uploadOutcome" <> 'ACKNOWLEDGED' THEN
    RAISE EXCEPTION 'Acknowledged export outcome cannot regress';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DataExportArtifact_immutable_identity"
  BEFORE UPDATE ON "DataExportArtifact" FOR EACH ROW EXECUTE FUNCTION enforce_data_export_artifact_identity();
