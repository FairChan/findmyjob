-- CreateEnum
CREATE TYPE "PaymentProviderKind" AS ENUM ('BANK_TRANSFER', 'STRIPE');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "commercialSnapshot" JSONB,
ADD COLUMN     "paymentProvider" "PaymentProviderKind";

-- CreateTable
CREATE TABLE "PaymentProofUpload" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentProofUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProofUpload_storageKey_key" ON "PaymentProofUpload"("storageKey");

-- CreateIndex
CREATE INDEX "PaymentProofUpload_companyId_createdAt_idx" ON "PaymentProofUpload"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentProofUpload" ADD CONSTRAINT "PaymentProofUpload_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
