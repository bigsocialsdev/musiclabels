import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { legalDocuments } from '@/db/schema';
import { loadSession, requireVerified, safeNext } from '@/lib/identity/server';
import { LEGAL_KINDS, checkAcceptance, recordAcceptance, type LegalKind } from '@/lib/legal/server';
import { getDb } from '@/lib/platform/db';

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
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/legal/accept?kinds=${kinds.join(',')}&next=${target}`)}`);
  }
  const db = getDb();
  const check = await checkAcceptance(db, guard.value.userId, kinds);
  if (check.ok) redirect(target);

  const docs = await Promise.all(
    check.pending.map(async (d) => {
      const [row] = await db.select({ body: legalDocuments.bodyMarkdown }).from(legalDocuments).where(eq(legalDocuments.id, d.id));
      return { ...d, body: row?.body ?? '' };
    }),
  );

  async function accept() {
    'use server';
    const g = requireVerified(await loadSession());
    if (!g.ok) redirect('/auth/sign-in');
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const userAgent = h.get('user-agent');
    // Re-read what is pending now so only current versions are ever recorded.
    const now = await checkAcceptance(getDb(), g.value.userId, kinds);
    if (!now.ok) {
      for (const d of now.pending) await recordAcceptance(getDb(), { userId: g.value.userId, documentId: d.id, ip, userAgent });
    }
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
      {docs.map((d) => (
        <section key={d.id} className="mt-4">
          <h2 className="font-medium">
            {d.kind} (version {d.version})
          </h2>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border p-3 text-sm">{d.body}</pre>
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
