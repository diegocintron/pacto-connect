-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantSettlement" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "escrowId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "asset" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantSettlement_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN "merchantId" TEXT;
ALTER TABLE "WebhookEndpoint" ADD COLUMN "merchantId" TEXT;
ALTER TABLE "WebhookEvent" ADD COLUMN "merchantId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "merchantId" TEXT;

-- CreateIndex
CREATE INDEX "Merchant_apiKeyId_idx" ON "Merchant"("apiKeyId");
CREATE INDEX "Merchant_status_idx" ON "Merchant"("status");
CREATE UNIQUE INDEX "MerchantSettlement_escrowId_key" ON "MerchantSettlement"("escrowId");
CREATE INDEX "MerchantSettlement_merchantId_idx" ON "MerchantSettlement"("merchantId");
CREATE INDEX "CheckoutSession_merchantId_idx" ON "CheckoutSession"("merchantId");
CREATE INDEX "WebhookEndpoint_merchantId_idx" ON "WebhookEndpoint"("merchantId");
CREATE INDEX "WebhookEvent_merchantId_idx" ON "WebhookEvent"("merchantId");
CREATE INDEX "Subscription_merchantId_idx" ON "Subscription"("merchantId");

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantSettlement" ADD CONSTRAINT "MerchantSettlement_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
