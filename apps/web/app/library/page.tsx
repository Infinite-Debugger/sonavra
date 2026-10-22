import type { Metadata } from 'next';
import Library from '@/components/Library';
import { requireUser } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Library' };
export default async function LibraryPage() {
  await requireUser('/library');
  return <Library />;
}
