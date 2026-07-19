-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('pending', 'completed');

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'pending',
    "statusCode" INTEGER,
    "responseBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookNonce_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN "sourceEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_apiKeyId_key_key" ON "IdempotencyRecord"("apiKeyId", "key");
CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");
CREATE UNIQUE INDEX "WebhookNonce_nonce_key" ON "WebhookNonce"("nonce");
CREATE INDEX "WebhookNonce_expiresAt_idx" ON "WebhookNonce"("expiresAt");
CREATE UNIQUE INDEX "WebhookEvent_sourceEventId_key" ON "WebhookEvent"("sourceEventId");
