import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { legalDocuments, licenseTermsVersions } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';
import { PLATFORMS, TIERS, type Platform, type Tier } from '../index';

export const termsInputSchema = z
  .object({
    tier: z.enum(TIERS),
    termKind: z.enum(['perpetual', 'fixed_months']),
    termMonths: z.number().int().positive().max(120).nullable(),
    videoCap: z.number().int().positive().nullable(),
    maxChannels: z.number().int().positive().max(20),
    allowedPlatforms: z.array(z.enum(PLATFORMS)).min(1),
    organicOnly: z.boolean(),
    licenseTextDocumentId: z.uuid(),
    effectiveAt: z.date().optional(),
  })
  .refine((t) => (t.termKind === 'perpetual') === (t.termMonths === null), 'termMonths is required for fixed terms and absent for perpetual');
export type TermsInput = z.input<typeof termsInputSchema>;

export type TermsVersion = {
  id: string;
  tier: Tier;
  version: number;
  termKind: 'perpetual' | 'fixed_months';
  termMonths: number | null;
  videoCap: number | null;
  maxChannels: number;
  allowedPlatforms: Platform[];
  organicOnly: boolean;
  licenseTextDocumentId: string;
  licenseTextVersion: number;
  licenseTextSha256: string;
  effectiveAt: Date;
};

const columns = {
  id: licenseTermsVersions.id,
  tier: licenseTermsVersions.tier,
  version: licenseTermsVersions.version,
  termKind: licenseTermsVersions.termKind,
  termMonths: licenseTermsVersions.termMonths,
  videoCap: licenseTermsVersions.videoCap,
  maxChannels: licenseTermsVersions.maxChannels,
  allowedPlatforms: licenseTermsVersions.allowedPlatforms,
  organicOnly: licenseTermsVersions.organicOnly,
  licenseTextDocumentId: licenseTermsVersions.licenseTextDocumentId,
  licenseTextVersion: legalDocuments.version,
  licenseTextSha256: legalDocuments.sha256,
  effectiveAt: licenseTermsVersions.effectiveAt,
};

/**
 * Publishes the next immutable terms version for a tier. Superadmin only, like the license texts it points at;
 * the text must be that tier's license document. Existing licenses keep the version they pinned.
 */
export async function publishTermsVersion(db: DbOrTx, admin: AdminContext, input: TermsInput, ip?: string | null): Promise<TermsVersion> {
  requirePermission(admin, 'superadmin');
  const t = termsInputSchema.parse(input);
  return db.transaction(async (tx) => {
    const [doc] = await tx.select({ kind: legalDocuments.kind }).from(legalDocuments).where(eq(legalDocuments.id, t.licenseTextDocumentId));
    if (doc?.kind !== `license_${t.tier}`) throw new Error(`license text must be a license_${t.tier} document`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'license_terms:' + t.tier}))`);
    const [latest] = await tx
      .select({ version: licenseTermsVersions.version })
      .from(licenseTermsVersions)
      .where(eq(licenseTermsVersions.tier, t.tier))
      .orderBy(desc(licenseTermsVersions.version))
      .limit(1);
    const [row] = await tx
      .insert(licenseTermsVersions)
      .values({ ...t, version: (latest?.version ?? 0) + 1, effectiveAt: t.effectiveAt ?? new Date() })
      .returning({ id: licenseTermsVersions.id });
    await writeAudit(tx, {
      actorUserId: admin.userId,
      action: 'license_terms.publish',
      entityType: 'license_terms_version',
      entityId: row!.id,
      after: t,
      ip,
    });
    return (await getTermsVersion(tx, row!.id))!;
  });
}

export async function getTermsVersion(db: DbOrTx, id: string): Promise<TermsVersion | null> {
  const [row] = await db
    .select(columns)
    .from(licenseTermsVersions)
    .innerJoin(legalDocuments, eq(legalDocuments.id, licenseTermsVersions.licenseTextDocumentId))
    .where(eq(licenseTermsVersions.id, id));
  return (row as TermsVersion | undefined) ?? null;
}

/** The version in force for new sales: highest version whose effective_at has passed. */
export async function getCurrentTerms(db: DbOrTx, tier: Tier, at: Date = new Date()): Promise<TermsVersion | null> {
  const [row] = await db
    .select(columns)
    .from(licenseTermsVersions)
    .innerJoin(legalDocuments, eq(legalDocuments.id, licenseTermsVersions.licenseTextDocumentId))
    .where(and(eq(licenseTermsVersions.tier, tier), lte(licenseTermsVersions.effectiveAt, at)))
    .orderBy(desc(licenseTermsVersions.version))
    .limit(1);
  return (row as TermsVersion | undefined) ?? null;
}
