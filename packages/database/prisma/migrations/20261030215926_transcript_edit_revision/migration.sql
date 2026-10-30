-- AlterTable
ALTER TABLE "Transcript" ADD COLUMN     "revision" UUID NOT NULL DEFAULT gen_random_uuid();
