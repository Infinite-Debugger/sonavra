'use client';

import Link from 'next/link';

export default function RequestError({ retry }: { retry: () => void }) {
  return (
    <main className="min-h-[calc(100svh-4rem)] bg-white px-5 py-12 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto max-w-sm">
        <h1 className="text-2xl font-semibold">Unable to load this page</h1>
        <p
          role="alert"
          className="mt-3 text-sm text-zinc-600 dark:text-zinc-400"
        >
          Please try again in a moment.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={retry}
            className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:bg-emerald-400 dark:text-zinc-950"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Return to Sonavra
          </Link>
        </div>
      </div>
    </main>
  );
}
