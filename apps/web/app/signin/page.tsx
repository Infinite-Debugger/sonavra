import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AuthForm from '@/components/AuthForm';
import { currentUser } from '@/lib/auth/session';
import { safeReturnTo } from '@/lib/auth/return-to';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeReturnTo((await searchParams).next);
  if (await currentUser()) redirect(next);
  return <AuthForm mode="signin" returnTo={next} />;
}
