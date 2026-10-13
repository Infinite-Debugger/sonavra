'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { safeReturnTo } from '@/lib/auth/return-to';

export default function AuthForm({
  mode,
  returnTo,
}: {
  mode: 'signup' | 'signin';
  returnTo: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const signup = mode === 'signup';
  const next = safeReturnTo(returnTo);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: fields.get('email'),
          password: fields.get('password'),
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          data?.message ?? 'Unable to access your account. Please try again.',
        );
      }
      window.location.assign(next);
    } catch (error) {
      setError(
        error instanceof TypeError
          ? 'Could not connect to Sonavra. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Please try again.',
      );
      setPending(false);
    }
  }
  const inputClass =
    'mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-3 text-base outline-none focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/25 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900';
  return (
    <main className="min-h-[calc(100svh-4rem)] bg-white px-5 py-12 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:py-20">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-semibold">
          {signup ? 'Create an account' : 'Sign in'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {signup
            ? 'Transcription remains available without an account.'
            : 'Welcome back to Sonavra.'}
        </p>
        <form
          onSubmit={(event) => void submit(event)}
          className="mt-8 space-y-5"
          aria-busy={pending}
        >
          <div>
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              disabled={pending}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              required
              minLength={12}
              maxLength={128}
              disabled={pending}
              aria-describedby={signup ? 'password-hint' : undefined}
              className={inputClass}
            />
            {signup && (
              <p
                id="password-hint"
                className="mt-2 text-xs text-zinc-600 dark:text-zinc-400"
              >
                12 to 128 characters.
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 disabled:cursor-wait disabled:opacity-60 dark:bg-emerald-400 dark:text-zinc-950 dark:hover:bg-emerald-300"
          >
            {pending ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          {signup ? 'Already have an account? ' : 'New to Sonavra? '}
          <Link
            href={`/${signup ? 'signin' : 'signup'}?next=${encodeURIComponent(next)}`}
            className="rounded-sm font-medium text-emerald-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-emerald-300"
          >
            {signup ? 'Sign in' : 'Create account'}
          </Link>
        </p>
        <Link
          href={next === '/account' ? '/' : next}
          className="mt-6 inline-block rounded-sm text-sm text-zinc-600 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-zinc-400"
        >
          Continue without an account
        </Link>
      </div>
    </main>
  );
}
