'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AccountUser, AccountSessionResponse } from '@sonavra/types';
import { safeReturnTo } from '@/lib/auth/return-to';

export default function AccountNavigation() {
  const pathname = usePathname();
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Session unavailable');
        return response.json() as Promise<AccountSessionResponse>;
      })
      .then(({ user }) => {
        setUser(user);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, []);
  const next = encodeURIComponent(safeReturnTo(pathname));
  const linkClass =
    'rounded-sm px-2 py-2 text-sm font-medium hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:hover:text-emerald-300';
  return (
    <header className="border-b border-zinc-200 bg-white text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <nav
        aria-label="Main"
        className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-5"
      >
        <Link
          href="/"
          className="rounded-sm text-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
        >
          Sonavra
        </Link>
        <div className="flex min-h-10 items-center gap-2" aria-busy={!loaded}>
          {loaded &&
            (user ? (
              <>
                <Link className={linkClass} href="/library">
                  Library
                </Link>
                <Link className={linkClass} href="/account">
                  Account
                </Link>
              </>
            ) : (
              <>
                <Link className={linkClass} href={`/signin?next=${next}`}>
                  Sign in
                </Link>
                <Link className={linkClass} href={`/signup?next=${next}`}>
                  Create account
                </Link>
              </>
            ))}
        </div>
      </nav>
    </header>
  );
}
