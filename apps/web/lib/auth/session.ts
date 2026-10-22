import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AccountSessionResponse } from '@sonavra/types';

export async function currentUser() {
  const token = (await cookies()).get('sonavraAccountSession')?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const apiOrigin =
    process.env.API_INTERNAL_URL ??
    `http://localhost:${process.env.API_PORT ?? '3001'}`;
  const response = await fetch(`${apiOrigin}/auth/account`, {
    headers: { cookie: `sonavraAccountSession=${token}` },
    cache: 'no-store',
  });
  if (response.status === 401) return null;
  if (!response.ok)
    throw new Error('Unable to load your account. Please try again.');
  const data = (await response.json()) as AccountSessionResponse;
  return data.user;
}

export async function requireUser(returnTo = '/account') {
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(returnTo)}`);
  return user;
}
