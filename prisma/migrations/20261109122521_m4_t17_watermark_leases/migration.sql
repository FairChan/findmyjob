-- CreateTable
CREATE TABLE "ConcurrencyLease" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConcurrencyLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConcurrencyLease_scope_expiresAt_idx" ON "ConcurrencyLease"("scope", "expiresAt");

-- CreateIndex
CREATE INDEX "ConcurrencyLease_scope_ownerKey_expiresAt_idx" ON "ConcurrencyLease"("scope", "ownerKey", "expiresAt");
