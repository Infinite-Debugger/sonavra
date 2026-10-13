import type { Metadata } from 'next';
import Link from 'next/link';
import SignOutButton from '@/components/SignOutButton';
import { requireUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Account' };

export default async function Account() {
  const user = await requireUser();
  return (
    <main className="min-h-[calc(100svh-4rem)] bg-white px-5 py-12 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold">Account</h1>
        <dl className="my-8 border-y border-zinc-200 py-5 dark:border-zinc-800">
          <dt className="text-sm text-zinc-600 dark:text-zinc-400">Email</dt>
          <dd className="mt-2 break-all text-base font-medium">{user.email}</dd>
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="rounded-sm text-sm font-medium text-emerald-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 dark:text-emerald-300"
          >
            Upload a recording
          </Link>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
