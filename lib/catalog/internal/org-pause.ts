import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { trackEvents, tracks } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { applyTransition } from './transition';

/** The reason stored on the suspend event, so a later reinstatement resumes exactly the tracks this suspension paused. */
export const orgPauseReason = (orgId: string) => `org_suspended:${orgId}`;

/**
 * Takes an org's published tracks off sale because the org is suspended (S4-M10c). Each goes through the transition
 * table (`suspend`), so it gets its event row. Existing licenses are untouched. Returns the tracks it paused.
 */
export async function pauseOrgTracks(db: DbOrTx, orgId: string, actorUserId: string, ip?: string | null): Promise<string[]> {
  const rows = await db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.sellerOrgId, orgId), eq(tracks.status, 'published'))).orderBy(tracks.id);
  const paused: string[] = [];
  for (const { id } of rows) {
    const reason = orgPauseReason(orgId);
    const r = await applyTransition(db, id, 'suspend', actorUserId, { reason, audit: { action: 'track.suspend', before: { status: 'published' }, after: { status: 'suspended', reason, viaOrg: orgId }, ip } });
    if (r.ok) paused.push(id);
  }
  return paused;
}

/**
 * Reverses `pauseOrgTracks`: reinstates the org's suspended tracks whose latest event is the suspension this org
 * pause wrote. A track an admin suspended for another reason, or reclassified to class C, stays suspended.
 * Returns the tracks it resumed.
 */
export async function resumeOrgTracks(db: DbOrTx, orgId: string, actorUserId: string, ip?: string | null): Promise<string[]> {
  const candidates = await db.select({ id: tracks.id }).from(tracks).where(and(eq(tracks.sellerOrgId, orgId), eq(tracks.status, 'suspended'), ne(tracks.clearanceClass, 'C'))).orderBy(tracks.id);
  if (candidates.length === 0) return [];
  const events = await db
    .select({ trackId: trackEvents.trackId, event: trackEvents.event, reason: trackEvents.reason })
    .from(trackEvents)
    .where(inArray(trackEvents.trackId, candidates.map((c) => c.id)))
    .orderBy(desc(trackEvents.at), desc(trackEvents.id));
  const latest = new Map<string, { event: string; reason: string | null }>();
  for (const e of events) if (!latest.has(e.trackId)) latest.set(e.trackId, e);
  const resumed: string[] = [];
  for (const { id } of candidates) {
    const last = latest.get(id);
    if (last?.event !== 'suspend' || last.reason !== orgPauseReason(orgId)) continue;
    const reason = `org_reinstated:${orgId}`;
    const r = await applyTransition(db, id, 'reinstate', actorUserId, { reason, audit: { action: 'track.reinstate', before: { status: 'suspended' }, after: { status: 'published', reason, viaOrg: orgId }, ip } });
    if (r.ok) resumed.push(id);
  }
  return resumed;
}
