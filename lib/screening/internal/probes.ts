import { and, asc, desc, eq } from 'drizzle-orm';
import { claimProbes, screenings } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';
import type { ClaimPlatform, ObservedClaim, ScreenMatch, ScreenStatus } from '../index';

export type ProbeInput = { versionId: string; platform: ClaimPlatform; claims: ObservedClaim[]; notes?: string | null };

/** Admin records what a private upload of the track on the platform's test channel/page showed. */
export async function recordClaimProbe(db: DbOrTx, admin: AdminContext, input: ProbeInput, ip?: string | null): Promise<string> {
  requirePermission(admin, 'verification');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(claimProbes)
      .values({
        trackVersionId: input.versionId,
        platform: input.platform,
        probedBy: admin.userId,
        claimsObserved: input.claims,
        notes: input.notes ?? null,
      })
      .returning({ id: claimProbes.id });
    await writeAudit(tx, {
      actorUserId: admin.userId,
      action: 'claim_probe.record',
      entityType: 'track_version',
      entityId: input.versionId,
      after: { probeId: row!.id, platform: input.platform, claims: input.claims.length },
      ip,
    });
    return row!.id;
  });
}

export type ReviewFacts = {
  screening: { id: string; provider: string; status: ScreenStatus | 'queued'; matches: ScreenMatch[] } | null;
  probes: { id: string; platform: ClaimPlatform; claims: ObservedClaim[]; notes: string | null; probedAt: Date }[];
};

/** What the admin (and the approve guard) needs to know about a version's screening and probes. */
export async function getReviewFacts(db: DbOrTx, versionId: string): Promise<ReviewFacts> {
  const [screening] = await db.select().from(screenings).where(eq(screenings.trackVersionId, versionId)).orderBy(desc(screenings.createdAt)).limit(1);
  const probes = await db.select().from(claimProbes).where(and(eq(claimProbes.trackVersionId, versionId))).orderBy(asc(claimProbes.probedAt));
  return {
    screening: screening
      ? { id: screening.id, provider: screening.provider, status: screening.status as ScreenStatus | 'queued', matches: screening.matches as ScreenMatch[] }
      : null,
    probes: probes.map((p) => ({ id: p.id, platform: p.platform as ClaimPlatform, claims: p.claimsObserved as ObservedClaim[], notes: p.notes, probedAt: p.probedAt })),
  };
}
