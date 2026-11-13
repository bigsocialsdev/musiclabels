'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { issueDownloadUrl, resolveBuyerActor } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { requireBuyerSession } from '@/app/buyer-session';

/** POST only: each click counts against the 20-download cap, so a prefetch must never trigger it. */
export async function downloadAction(licenseId: string, file: 'master' | 'mp3') {
  const id = z.uuid().parse(licenseId);
  const kind = z.enum(['master', 'mp3']).parse(file);
  const session = await requireBuyerSession(`/licenses/${id}`);
  const db = getDb();
  const actor = await resolveBuyerActor(db, session.userId, id);
  const r = actor ? await issueDownloadUrl(db, actor, id, kind) : { ok: false as const, issues: ['not_found'] };
  if (!r.ok) redirect(`/licenses/${id}?error=${encodeURIComponent(r.issues[0]!)}`);
  redirect(r.value.url);
}
