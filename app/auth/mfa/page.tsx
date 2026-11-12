import { redirect } from 'next/navigation';
import { loadSession, requireVerified, safeNext } from '@/lib/identity/server';
import { MfaForm } from './mfa-form';

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  if (!requireVerified(await loadSession()).ok) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/auth/mfa?next=${target}`)}`);
  }
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-xl font-semibold">Two-factor authentication</h1>
      <MfaForm next={target} />
    </main>
  );
}
