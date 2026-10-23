-- CreateTable
CREATE TABLE "TranscriptSummary" (
    "id" UUID NOT NULL,
    "transcriptId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "keyPoints" TEXT[],
    "actionItems" TEXT[],
    "sourceHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSummary_transcriptId_key" ON "TranscriptSummary"("transcriptId");

-- AddForeignKey
ALTER TABLE "TranscriptSummary" ADD CONSTRAINT "TranscriptSummary_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
