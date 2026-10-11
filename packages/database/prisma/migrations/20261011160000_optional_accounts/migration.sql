ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

CREATE TABLE "AccountSession" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountSession_tokenHash_key" ON "AccountSession"("tokenHash");
CREATE INDEX "AccountSession_userId_idx" ON "AccountSession"("userId");
CREATE INDEX "AccountSession_expiresAt_idx" ON "AccountSession"("expiresAt");
ALTER TABLE "AccountSession" ADD CONSTRAINT "AccountSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
