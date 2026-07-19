-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'canceled');

-- CreateEnum
CREATE TYPE "SubscriptionChargeStatus" AS ENUM ('succeeded', 'failed');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "payerRef" TEXT,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "asset" TEXT NOT NULL DEFAULT 'USDC',
    "interval" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "failNextCharge" BOOLEAN NOT NULL DEFAULT false,
    "nextChargeAt" TIMESTAMP(3) NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCharge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "status" "SubscriptionChargeStatus" NOT NULL,
    "quote" JSONB NOT NULL,
    "escrowId" TEXT,
    "failureReason" TEXT,
    "attempt" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_apiKeyId_idx" ON "Subscription"("apiKeyId");

-- CreateIndex
CREATE INDEX "Subscription_status_nextChargeAt_idx" ON "Subscription"("status", "nextChargeAt");

-- CreateIndex
CREATE INDEX "SubscriptionCharge_subscriptionId_idx" ON "SubscriptionCharge"("subscriptionId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
