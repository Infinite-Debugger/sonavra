import type { PrismaClient } from '@sonavra/database';

export class GuestClaimValidationError extends Error {}

export function isGuestSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  );
}

export function guestSessionFrom(body: unknown) {
  const value =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).guestSessionId
      : undefined;
  if (value === undefined) return undefined;
  if (!isGuestSessionId(value))
    throw new GuestClaimValidationError('A valid guest session is required.');
  return value;
}

export async function claimGuestRecordings(
  database: Pick<PrismaClient, 'recording'>,
  userId: string,
  guestSessionId: string,
) {
  const now = new Date();
  // A conditional update transfers ownership atomically, including concurrent retries.
  const result = await database.recording.updateMany({
    where: {
      guestSessionId,
      userId: null,
      expiresAt: { gt: now },
      guestSession: { expiresAt: { gt: now } },
      status: { not: 'UPLOADING' },
    },
    data: { userId, guestSessionId: null, expiresAt: null },
  });
  return { claimedCount: result.count };
}
