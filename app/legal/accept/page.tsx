import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { ensureUser, loadSession, requireVerified, safeNext } from '@/lib/identity/server';
import { LEGAL_KINDS, acceptPending, checkAcceptance, type LegalKind } from '@/lib/legal/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';

const DEFAULT_KINDS: LegalKind[] = ['tos', 'privacy'];

function parseKinds(raw: string | undefined): LegalKind[] {
  const kinds = (raw?.split(',') ?? []).filter((k): k is LegalKind => (LEGAL_KINDS as readonly string[]).includes(k));
  return kinds.length ? kinds : DEFAULT_KINDS;
}

export default async function AcceptPage({ searchParams }: { searchParams: Promise<{ kinds?: string; next?: string }> }) {
  const { kinds: rawKinds, next } = await searchParams;
  const kinds = parseKinds(rawKinds);
  const target = safeNext(next);
  const guard = requireVerified(await loadSession());
  if (!guard.ok) {
    const back = `/legal/accept?${new URLSearchParams({ kinds: kinds.join(','), next: target })}`;
    redirect(`/auth/sign-in?${new URLSearchParams({ next: back })}`);
  }
  const session = guard.value;
  const db = getDb();
  await ensureUser(db, session); // acceptances reference users(id)
  const check = await checkAcceptance(db, session.userId, kinds);
  if (check.ok) redirect(target);

  async function accept() {
    'use server';
    const g = requireVerified(await loadSession());
    if (!g.ok) redirect('/auth/sign-in');
    const h = await headers();
    await ensureUser(getDb(), g.value);
    await acceptPending(getDb(), { userId: g.value.userId, kinds, ip: clientIp(h), userAgent: h.get('user-agent') });
    redirect(target);
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">Please review and accept</h1>
      {check.noDocument.length > 0 && (
        <p role="alert" className="mt-2 text-red-600">
          These documents are not available yet: {check.noDocument.join(', ')}.
        </p>
      )}
      {check.pending.map((d) => (
        <section key={d.id} className="mt-4">
          <h2 className="font-medium">
            {d.kind} (version {d.version})
          </h2>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border p-3 text-sm">{d.bodyMarkdown}</pre>
        </section>
      ))}
      {check.noDocument.length === 0 && (
        <form action={accept} className="mt-6">
          <button className="rounded bg-black px-4 py-2 text-white">I accept</button>
        </form>
      )}
    </main>
  );
}
