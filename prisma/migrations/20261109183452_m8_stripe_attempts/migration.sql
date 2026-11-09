-- CreateEnum
CREATE TYPE "StripeCheckoutAttemptState" AS ENUM ('CREATING', 'OPEN', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'RECONCILIATION_REQUIRED');

-- CreateTable
CREATE TABLE "StripeCheckoutAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sessionId" TEXT,
    "paymentIntentId" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestSnapshot" JSONB NOT NULL,
    "state" "StripeCheckoutAttemptState" NOT NULL DEFAULT 'CREATING',
    "fpxReceipt" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StripeCheckoutAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeCheckoutAttempt_orderId_key" ON "StripeCheckoutAttempt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCheckoutAttempt_idempotencyKey_key" ON "StripeCheckoutAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCheckoutAttempt_sessionId_key" ON "StripeCheckoutAttempt"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeCheckoutAttempt_paymentIntentId_key" ON "StripeCheckoutAttempt"("paymentIntentId");

-- AddForeignKey
ALTER TABLE "StripeCheckoutAttempt" ADD CONSTRAINT "StripeCheckoutAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
