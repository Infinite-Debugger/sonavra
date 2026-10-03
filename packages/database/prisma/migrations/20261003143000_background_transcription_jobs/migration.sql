ALTER TABLE "TranscriptionJob"
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX "TranscriptionJob_status_availableAt_idx"
ON "TranscriptionJob"("status", "availableAt");

CREATE INDEX "TranscriptionJob_status_leaseExpiresAt_idx"
ON "TranscriptionJob"("status", "leaseExpiresAt");
