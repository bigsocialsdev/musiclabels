import { redirect } from 'next/navigation';
import { ensureUser, loadSession, requireVerified, safeNext } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';
import { MfaForm } from './mfa-form';

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  const guard = requireVerified(await loadSession());
  if (!guard.ok) {
    const back = `/auth/mfa?${new URLSearchParams({ next: target })}`;
    redirect(`/auth/sign-in?${new URLSearchParams({ next: back })}`);
  }
  await ensureUser(getDb(), guard.value);
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-xl font-semibold">Two-factor authentication</h1>
      <MfaForm next={target} />
    </main>
  );
}
