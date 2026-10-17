import { AuthService, sessionToken } from './auth.js';
import { isGuestSessionId } from './guest-claims.js';

export async function recordingAccess(
  auth: AuthService,
  cookie?: string,
  guestSessionId?: string,
) {
  const user = await auth.currentUser(sessionToken(cookie));
  const now = new Date();
  return {
    userId: user?.id,
    where: {
      OR: [
        ...(user ? [{ userId: user.id }] : []),
        ...(isGuestSessionId(guestSessionId)
          ? [
              {
                userId: null,
                guestSessionId,
                expiresAt: { gt: now },
                guestSession: { expiresAt: { gt: now } },
              },
            ]
          : []),
      ],
    },
  };
}
