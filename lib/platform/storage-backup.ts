import 'server-only';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { storageBackups } from '@/db/schema';
import type { DbOrTx } from './db';
import { errorMessage, log } from './log';
import { BUCKETS, type Bucket, type ObjectStore } from './storage';

/**
 * Off-site copy of Supabase Storage (PLAN F11): Supabase's own backups cover the database, not the objects. Masters,
 * rights documents and the PDFs (certificates, invoices, credit notes, statements) go to an S3-compatible bucket
 * (Cloudflare R2). Previews and waveforms are derived from the masters and are rebuilt by the ingest handler, so they are not copied.
 */
export const BACKED_UP_BUCKETS: readonly Bucket[] = [BUCKETS.masters, BUCKETS.documents, BUCKETS.pdfs];

/** Where the copies go. R2 in production (`offsite-r2.ts`); tests substitute a map. */
export interface OffsiteStore {
  /** Stores the object under `key` and returns the MD5 (hex) the store computed for the bytes it received. */
  put(key: string, body: Buffer, contentType?: string): Promise<{ md5: string }>;
  /** The stored bytes, or null when there is no such object. */
  get(key: string): Promise<Buffer | null>;
}

export const offsiteKey = (bucket: string, objectPath: string) => `${bucket}/${objectPath}`;
export const md5Hex = (body: Buffer) => createHash('md5').update(body).digest('hex');

const MAX_PER_RUN = 500;
/** The cron's function limit is 300 s; stop starting new objects well before it. The rest waits for the next run. */
const DEFAULT_BUDGET_MS = 200_000;

type Pending = { bucket: string; path: string; updatedAt: Date; mime: string | null };

/**
 * Storage objects with no manifest row yet, or changed since their copy (FROM and WHERE, alias `o`). Postgres keeps
 * microseconds but the manifest holds the JavaScript millisecond value, so the comparison is made at milliseconds:
 * otherwise an unchanged object would look changed on every run.
 */
export const UNSYNCED_OBJECTS = (() => {
  const buckets = sql.join(BACKED_UP_BUCKETS.map((b) => sql`${b}`), sql`, `);
  return sql`FROM storage.objects o
    LEFT JOIN ${storageBackups} b ON b.bucket = o.bucket_id AND b.path = o.name
    WHERE o.bucket_id IN (${buckets}) AND o.name NOT LIKE '%.emptyFolderPlaceholder'
      AND (b.path IS NULL OR date_trunc('milliseconds', o.updated_at) > b.source_updated_at)`;
})();

/** How many Storage objects have no up-to-date copy. */
export async function countUnsynced(db: DbOrTx): Promise<number> {
  const [count] = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n ${UNSYNCED_OBJECTS}`);
  return count!.n;
}

/** The oldest unsynced objects first, so a backlog drains in order. */
async function pendingObjects(db: DbOrTx, limit: number): Promise<{ rows: Pending[]; total: number }> {
  const unsynced = UNSYNCED_OBJECTS;
  const rows = await db.execute<Pending>(sql`SELECT o.bucket_id AS bucket, o.name AS path, o.updated_at AS "updatedAt", o.metadata->>'mimetype' AS mime ${unsynced} ORDER BY o.updated_at, o.name LIMIT ${limit}`);
  return { rows: [...rows], total: await countUnsynced(db) };
}

export type BackupRun = { copied: number; bytes: number; failed: number; remaining: number };

/**
 * Copies every new or changed object off-site, confirming each copy by the MD5 the off-site store reports, then records
 * it in `storage_backups`. Idempotent and resumable: a run that stops on its time budget or on a failure leaves the rest
 * pending for the next. Nothing is ever deleted off-site, so an object removed from Storage is still restorable.
 * Throws after the pass when any object failed, so the cron reports the run as failed.
 */
export async function backupStorage(
  db: DbOrTx,
  deps: { store: ObjectStore; offsite: OffsiteStore; budgetMs?: number; maxObjects?: number },
): Promise<BackupRun> {
  const started = Date.now();
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const { rows, total } = await pendingObjects(db, deps.maxObjects ?? MAX_PER_RUN);
  const scratch = await mkdtemp(path.join(tmpdir(), 'storage-backup-'));
  const failures: string[] = [];
  let copied = 0;
  let bytes = 0;
  try {
    for (const obj of rows) {
      if (Date.now() - started > budget) break;
      const where = offsiteKey(obj.bucket, obj.path);
      try {
        const file = path.join(scratch, 'object');
        await deps.store.downloadToFile(obj.bucket as Bucket, obj.path, file);
        const body = await readFile(file);
        const md5 = md5Hex(body);
        const stored = await deps.offsite.put(where, body, obj.mime ?? undefined);
        if (stored.md5 !== md5) throw new Error(`off-site MD5 ${stored.md5 || '(none)'} differs from ${md5}`);
        await db
          .insert(storageBackups)
          .values({ bucket: obj.bucket, path: obj.path, sourceUpdatedAt: new Date(obj.updatedAt), sizeBytes: body.length, md5 })
          .onConflictDoUpdate({
            target: [storageBackups.bucket, storageBackups.path],
            set: { sourceUpdatedAt: new Date(obj.updatedAt), sizeBytes: body.length, md5, backedUpAt: sql`now()` },
          });
        copied++;
        bytes += body.length;
      } catch (e) {
        failures.push(`${where}: ${errorMessage(e).slice(0, 120)}`);
        log.error('storage backup failed for an object', { object: where, error: errorMessage(e) });
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const run = { copied, bytes, failed: failures.length, remaining: total - copied };
  if (failures.length > 0) throw new Error(`Storage backup: ${failures.length} of ${rows.length} objects failed (${copied} copied, ${run.remaining} still pending). First: ${failures[0]}`);
  return run;
}
