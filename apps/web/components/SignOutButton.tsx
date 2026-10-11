'use client';

import { useState } from 'react';

export default function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/signout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok)
        throw new Error('Could not sign out. Please try again.');
      window.location.assign('/');
    } catch {
      setError('Could not sign out. Please try again.');
      setPending(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
