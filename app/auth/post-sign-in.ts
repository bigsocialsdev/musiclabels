import { ensureUser, safeNext, type Session } from '@/lib/identity/server';
import { checkAcceptance } from '@/lib/legal/server';
import { getDb } from '@/lib/platform/db';

/**
 * Shared by the OTP form action and the OAuth callback: creates the app user row, then returns where to
 * go next. A user who has not accepted the current ToS/privacy version (e.g. a new one was published)
 * is sent to the acceptance page first. Unpublished documents do not redirect (nothing to accept yet).
 */
export async function completeSignIn(session: Session, next?: string | null): Promise<string> {
  const db = getDb();
  await ensureUser(db, session);
  const target = safeNext(next);
  const gate = await checkAcceptance(db, session.userId, ['tos', 'privacy']);
  if (!gate.ok && gate.pending.length > 0) return `/legal/accept?${new URLSearchParams({ next: target })}`;
  return target;
}
