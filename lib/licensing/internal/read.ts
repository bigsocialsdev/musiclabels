import { eq } from 'drizzle-orm';
import { licenses } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { effectiveStatus, normalizePublicId, type LicenseStatus } from '../index';
import type { License } from './issue';
import { isRecordIntact } from './record-hash';

export type ResolvedLicense = License & { effectiveStatus: LicenseStatus; recordIntact: boolean };

/**
 * Resolves a typed or scanned public id. Status is the effective one (a lapsed paid-ad license reads as
 * expired before the sweep stores it); `recordIntact` recomputes the record hash from the stored row.
 */
export async function getLicenseByPublicId(db: DbOrTx, rawPublicId: string, now: Date = new Date()): Promise<ResolvedLicense | null> {
  const publicId = normalizePublicId(rawPublicId);
  if (!publicId) return null;
  const [row] = await db.select().from(licenses).where(eq(licenses.publicId, publicId));
  if (!row) return null;
  return { ...row, effectiveStatus: effectiveStatus(row, now), recordIntact: isRecordIntact(row) };
}
