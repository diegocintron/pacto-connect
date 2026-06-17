-- CreateEnum
CREATE TYPE "CheckoutMode" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'expired', 'consumed', 'revoked');

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "mode" "CheckoutMode" NOT NULL,
    "listingId" TEXT,
    "quote" JSONB,
    "clientSecretHash" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckoutSession_apiKeyId_idx" ON "CheckoutSession"("apiKeyId");

-- CreateIndex
CREATE INDEX "CheckoutSession_status_idx" ON "CheckoutSession"("status");

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
