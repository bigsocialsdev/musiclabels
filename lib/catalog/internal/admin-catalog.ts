import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import { genres, moods, organizations, tracks } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import { hasOrgAccepted } from '@/lib/legal/server';
import { enqueueOpsAlert } from '@/lib/notifications/server';
import type { DbOrTx } from '@/lib/platform/db';
import { getSellerStanding } from '@/lib/sellers/server';
import { TRACK_STATUSES, type TrackStatus } from '../index';
import { CatalogError } from './seller';
import { applyTransition } from './transition';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Tracks for the catalog screen (PLAN §9: Catalog admin), newest change first. `q` matches title or artist. */
export async function listAdminTracks(db: DbOrTx, admin: AdminContext, filter: { q?: string; status?: TrackStatus } = {}) {
  requirePermission(admin, 'verification');
  const q = filter.q?.trim();
  return db
    .select({
      id: tracks.id,
      title: tracks.title,
      primaryArtist: tracks.primaryArtist,
      status: tracks.status,
      clearanceClass: tracks.clearanceClass,
      priceLevel: tracks.priceLevel,
      sellerName: organizations.displayName,
      updatedAt: tracks.updatedAt,
    })
    .from(tracks)
    .innerJoin(organizations, eq(organizations.id, tracks.sellerOrgId))
    .where(
      and(
        filter.status && TRACK_STATUSES.includes(filter.status) ? eq(tracks.status, filter.status) : undefined,
        q ? or(ilike(tracks.title, `%${escapeLike(q)}%`), ilike(tracks.primaryArtist, `%${escapeLike(q)}%`)) : undefined,
      ),
    )
    .orderBy(desc(tracks.updatedAt))
    .limit(200);
}

/** PLAN §4.2: A → B (the seller now controls the release), A | B → C (no release path). Nothing moves back, and C is final. */
const RECLASSIFY: Record<string, readonly ('B' | 'C')[]> = { A: ['B', 'C'], B: ['C'] };

/**
 * Changes the clearance class of a published or suspended track. Moving to B needs the seller's accepted release
 * commitment and an ops contact (as approval does). Moving to C suspends the track and alerts ops to review its
 * active licenses; the licenses themselves are never touched (CLAUDE.md). Compare-and-set on the current class.
 */
export async function reclassifyTrack(db: DbOrTx, admin: AdminContext, input: { trackId: string; to: 'B' | 'C'; reason: string }, ip?: string | null) {
  requirePermission(admin, 'verification');
  const reason = input.reason.trim();
  if (!reason) throw new CatalogError('A reason is required');
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(tracks).where(eq(tracks.id, input.trackId)).for('update');
    if (!t) return { ok: false as const, reason: 'not_found' as const };
    if (t.status !== 'published' && t.status !== 'suspended') return { ok: false as const, reason: 'not_live' as const, status: t.status };
    if (!RECLASSIFY[t.clearanceClass ?? '']?.includes(input.to)) return { ok: false as const, reason: 'not_allowed' as const, from: t.clearanceClass };
    if (input.to === 'B') {
      const standing = await getSellerStanding(tx, t.sellerOrgId);
      if (!(await hasOrgAccepted(tx, t.sellerOrgId, 'release_commitment')) || !standing?.opsContactEmail) return { ok: false as const, reason: 'class_b_guard' as const };
    }
    const before = { clearanceClass: t.clearanceClass, status: t.status };
    if (input.to === 'C' && t.status === 'published') {
      const moved = await applyTransition(tx, t.id, 'suspend', admin.userId, { reason, set: { clearanceClass: 'C' } });
      if (!moved.ok) return { ok: false as const, reason: 'conflict' as const };
    } else {
      await tx.update(tracks).set({ clearanceClass: input.to, updatedAt: new Date() }).where(and(eq(tracks.id, t.id), eq(tracks.clearanceClass, t.clearanceClass!)));
    }
    await writeAudit(tx, { actorUserId: admin.userId, action: 'track.reclassify', entityType: 'track', entityId: t.id, before, after: { clearanceClass: input.to, status: input.to === 'C' ? 'suspended' : t.status, reason }, ip });
    if (input.to === 'C') await enqueueOpsAlert(tx, 'track_reclassified_c', 'Track moved to class C: review its active licenses', { trackId: t.id, reason });
    return { ok: true as const };
  });
}

export type TaxonomyKind = 'genre' | 'mood';
const table = (kind: TaxonomyKind) => (kind === 'genre' ? genres : moods);

/** Genres and moods including inactive ones, for the admin screen (sellers see only active ones: `listTaxonomy`). */
export async function listTaxonomyAdmin(db: DbOrTx, admin: AdminContext) {
  requirePermission(admin, 'verification');
  const [g, m] = await Promise.all([db.select().from(genres).orderBy(asc(genres.name)), db.select().from(moods).orderBy(asc(moods.name))]);
  return { genres: g, moods: m };
}

export async function createTaxonomyItem(db: DbOrTx, admin: AdminContext, input: { kind: TaxonomyKind; name: string }, ip?: string | null): Promise<{ ok: boolean }> {
  requirePermission(admin, 'verification');
  const name = input.name.trim();
  if (!name || name.length > 60) throw new CatalogError('A name of 1 to 60 characters is required');
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(table(input.kind)).values({ name }).onConflictDoNothing({ target: table(input.kind).name }).returning({ id: table(input.kind).id });
    if (!row) return { ok: false };
    await writeAudit(tx, { actorUserId: admin.userId, action: `${input.kind}.create`, entityType: input.kind, entityId: row.id, after: { name }, ip });
    return { ok: true };
  });
}

/** Retires or restores a genre or mood. Tracks keep the ids they already carry; only the seller pickers change. */
export async function setTaxonomyActive(db: DbOrTx, admin: AdminContext, input: { kind: TaxonomyKind; id: string; active: boolean }, ip?: string | null): Promise<{ ok: boolean }> {
  requirePermission(admin, 'verification');
  const t = table(input.kind);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(t).set({ active: input.active }).where(and(eq(t.id, input.id), eq(t.active, !input.active))).returning({ id: t.id, name: t.name });
    if (!row) return { ok: false };
    await writeAudit(tx, { actorUserId: admin.userId, action: `${input.kind}.set_active`, entityType: input.kind, entityId: row.id, before: { active: !input.active }, after: { active: input.active, name: row.name }, ip });
    return { ok: true };
  });
}
