-- CreateEnum
CREATE TYPE "InvoicePdfStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoicePdfErrorCode" AS ENUM ('PDF_RENDER_FAILED', 'PDF_STORAGE_FAILED', 'PDF_LEASE_EXPIRED', 'INVALID_INVOICE_SNAPSHOT', 'LEGACY_INVOICE_SNAPSHOT_MISSING', 'UNSUPPORTED_GLYPH', 'PDF_LAYOUT_EXCEEDED', 'PDF_TOO_LARGE', 'PDF_FONT_UNAVAILABLE');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "invoiceSnapshot" JSONB,
ADD COLUMN     "pdfAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pdfErrorCode" "InvoicePdfErrorCode",
ADD COLUMN     "pdfLeaseExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "pdfLeaseToken" TEXT,
ADD COLUMN     "pdfNextAttemptAt" TIMESTAMPTZ(3),
ADD COLUMN     "pdfSha256" TEXT,
ADD COLUMN     "pdfSizeBytes" INTEGER,
ADD COLUMN     "pdfStatus" "InvoicePdfStatus" NOT NULL DEFAULT 'READY';

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "lastValue" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceCounter_scope_key" ON "InvoiceCounter"("scope");

-- CreateIndex
CREATE INDEX "Invoice_pdfStatus_pdfNextAttemptAt_idx" ON "Invoice"("pdfStatus", "pdfNextAttemptAt");

-- CreateIndex
CREATE INDEX "Invoice_pdfStatus_pdfLeaseExpiresAt_idx" ON "Invoice"("pdfStatus", "pdfLeaseExpiresAt");
