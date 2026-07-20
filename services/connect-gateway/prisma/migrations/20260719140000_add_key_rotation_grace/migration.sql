-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "rotatedFromId" TEXT,
ADD COLUMN     "graceExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_rotatedFromId_key" ON "ApiKey"("rotatedFromId");

-- CreateIndex
CREATE INDEX "ApiKey_graceExpiresAt_idx" ON "ApiKey"("graceExpiresAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
