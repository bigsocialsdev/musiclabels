import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { getLicenseByPublicId } from '@/lib/licensing/server';
import type { DbOrTx } from '@/lib/platform/db';
import type { Bucket, ObjectStore } from '@/lib/platform/storage';
import { BACKED_UP_BUCKETS, md5Hex, offsiteKey, type OffsiteStore } from '@/lib/platform/storage-backup';

/**
 * Read-only checks for the restore drill (docs/restore-drill.md). Run against a database restored from a Supabase
 * backup and the off-site Storage copy: they prove the restore is complete and intact, not that production is healthy.
 */
export type Check = { name: string; ok: boolean; detail: string };

/** PLAN §10 and CLAUDE.md: tables that only ever gain rows, enforced by triggers a restore must bring back. */
export const APPEND_ONLY_TABLES = ['audit_log', 'acceptances', 'ledger_entries', 'order_events', 'dispute_events', 'legal_documents', 'license_terms_versions'] as const;

const pass = (name: string, detail: string): Check => ({ name, ok: true, detail });
const fail = (name: string, detail: string): Check => ({ name, ok: false, detail });
const verdict = (name: string, problems: string[], okDetail: string): Check => (problems.length === 0 ? pass(name, okDetail) : fail(name, problems.slice(0, 5).join('; ') + (problems.length > 5 ? `; and ${problems.length - 5} more` : '')));

type Row = Record<string, unknown>;
const rows = async (db: DbOrTx, query: ReturnType<typeof sql>) => [...(await db.execute<Row>(query))];

export function journalEntryCount(path = './db/migrations/meta/_journal.json'): number {
  return (JSON.parse(readFileSync(path, 'utf8')) as { entries: unknown[] }).entries.length;
}

/** Schema, constraints and money-trail checks over the restored database. `licenseSample` caps the record-hash recomputation (0 = all). */
export async function checkDatabase(db: DbOrTx, opts: { expectedMigrations: number; licenseSample?: number }): Promise<Check[]> {
  const checks: Check[] = [];

  const [applied] = await rows(db, sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`).catch(() => [{ n: -1 }]);
  checks.push(Number(applied!.n) === opts.expectedMigrations ? pass('migrations', `${opts.expectedMigrations} applied, as the repository expects`) : fail('migrations', `${applied!.n} applied, repository has ${opts.expectedMigrations}`));

  const open = await rows(db, sql`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1`);
  checks.push(verdict('row-level security', open.map((r) => `${r.name} has RLS off`), 'every public table has RLS enabled'));

  const triggers = await rows(db, sql`SELECT DISTINCT c.relname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal`);
  const have = new Set(triggers.map((r) => String(r.name)));
  checks.push(verdict('append-only triggers', APPEND_ONLY_TABLES.filter((t) => !have.has(t)).map((t) => `${t} has no trigger`), `${APPEND_ONLY_TABLES.length} append-only tables are guarded`));

  const series = await rows(db, sql`
    SELECT s.fy, s.kind, s.next_number - 1 AS allocated,
      CASE s.kind WHEN 'invoice' THEN (SELECT count(*) FROM invoices i WHERE i.fy = s.fy) ELSE (SELECT count(*) FROM credit_notes c WHERE c.fy = s.fy) END::int AS issued
    FROM invoice_series s ORDER BY 1, 2`);
  checks.push(verdict('gap-free numbering', series.filter((r) => Number(r.allocated) !== Number(r.issued)).map((r) => `${r.kind} ${r.fy}: ${r.allocated} numbers allocated, ${r.issued} issued`), `${series.length} series: every allocated number has its document`));

  const incomplete = await rows(db, sql`SELECT o.id FROM orders o WHERE o.status = 'fulfilled' AND (NOT EXISTS (SELECT 1 FROM licenses l WHERE l.order_id = o.id) OR NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id))`);
  checks.push(verdict('fulfilled orders', incomplete.map((r) => `order ${r.id} lacks its license or invoice`), 'every fulfilled order has its license and invoice'));

  const ids = await rows(db, sql`SELECT public_id FROM licenses ORDER BY starts_at DESC ${opts.licenseSample ? sql`LIMIT ${opts.licenseSample}` : sql``}`);
  const broken: string[] = [];
  for (const r of ids) {
    const l = await getLicenseByPublicId(db, String(r.public_id));
    if (!l?.recordIntact) broken.push(`${r.public_id} record hash does not match`);
  }
  checks.push(verdict('license record hashes', broken, `${ids.length} licenses recomputed, all match`));
  return checks;
}

export type StorageCheck = { objects: number; bytes: number; missing: string[]; corrupt: string[]; masterMismatch: string[]; notBackedUp: number | null };

/**
 * Reads every object (or a random `sample`) listed in the backup manifest back from the off-site store and checks it:
 * present, MD5 as recorded, and for masters the SHA-256 the database holds for that file. Also counts objects in
 * Storage that no backup has covered yet, when the Storage table is readable.
 */
export async function checkStorageRestore(db: DbOrTx, offsite: OffsiteStore, opts: { sample?: number } = {}): Promise<StorageCheck> {
  const manifest = await rows(db, sql`SELECT bucket, path, md5 FROM storage_backups ${opts.sample ? sql`ORDER BY random() LIMIT ${opts.sample}` : sql`ORDER BY bucket, path`}`);
  const out: StorageCheck = { objects: 0, bytes: 0, missing: [], corrupt: [], masterMismatch: [], notBackedUp: null };
  for (const m of manifest) {
    const key = offsiteKey(String(m.bucket), String(m.path));
    const body = await offsite.get(key);
    if (!body) {
      out.missing.push(key);
      continue;
    }
    out.objects++;
    out.bytes += body.length;
    if (md5Hex(body) !== m.md5) {
      out.corrupt.push(key);
      continue;
    }
    if (m.bucket === 'masters') {
      const [v] = await rows(db, sql`SELECT master_sha256 AS sha FROM track_versions WHERE master_key = ${String(m.path)}`);
      if (v?.sha && createHash('sha256').update(body).digest('hex') !== v.sha) out.masterMismatch.push(key);
    }
  }
  const [reachable] = await rows(db, sql`SELECT to_regclass('storage.objects') IS NOT NULL AS ok`);
  if (reachable?.ok) {
    const buckets = sql.join(BACKED_UP_BUCKETS.map((b) => sql`${b}`), sql`, `);
    const [n] = await rows(db, sql`SELECT count(*)::int AS n FROM storage.objects o LEFT JOIN storage_backups b ON b.bucket = o.bucket_id AND b.path = o.name WHERE o.bucket_id IN (${buckets}) AND o.name NOT LIKE '%.emptyFolderPlaceholder' AND (b.path IS NULL OR o.updated_at > b.source_updated_at)`);
    out.notBackedUp = Number(n!.n);
  }
  return out;
}

export function storageChecks(r: StorageCheck): Check[] {
  return [
    verdict('off-site objects present', r.missing.map((k) => `${k} missing`), `${r.objects} objects read back (${(r.bytes / 1_048_576).toFixed(1)} MiB)`),
    verdict('off-site objects intact', r.corrupt.map((k) => `${k} MD5 differs from the manifest`), 'every MD5 matches the manifest'),
    verdict('masters match the database', r.masterMismatch.map((k) => `${k} SHA-256 differs from track_versions`), 'every restored master has the SHA-256 the database recorded'),
    ...(r.notBackedUp === null ? [] : [r.notBackedUp === 0 ? pass('backup is current', 'nothing in Storage is waiting for a copy') : fail('backup is current', `${r.notBackedUp} objects in Storage have no up-to-date copy`)]),
  ];
}

const CONTENT_TYPES: Record<string, string> = { pdf: 'application/pdf', wav: 'audio/wav', mp3: 'audio/mpeg', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
const contentTypeOf = (objectPath: string) => CONTENT_TYPES[objectPath.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export type StorageRestore = { restored: number; bytes: number; missing: string[]; failed: string[] };

/**
 * Puts the off-site copies back into a Storage project (the RESTORED one: the caller points `target` at it) and reads each
 * back to confirm its MD5 against the manifest. Idempotent: uploading replaces. This is the Storage half of a real recovery.
 */
export async function restoreStorage(db: DbOrTx, offsite: OffsiteStore, target: ObjectStore, opts: { sample?: number } = {}): Promise<StorageRestore> {
  const manifest = await rows(db, sql`SELECT bucket, path, md5 FROM storage_backups ${opts.sample ? sql`ORDER BY random() LIMIT ${opts.sample}` : sql`ORDER BY bucket, path`}`);
  const out: StorageRestore = { restored: 0, bytes: 0, missing: [], failed: [] };
  const scratch = await mkdtemp(path.join(tmpdir(), 'restore-drill-'));
  try {
    for (const m of manifest) {
      const key = offsiteKey(String(m.bucket), String(m.path));
      try {
        const body = await offsite.get(key);
        if (!body) {
          out.missing.push(key);
          continue;
        }
        if (md5Hex(body) !== m.md5) throw new Error('off-site MD5 differs from the manifest');
        await target.upload(m.bucket as Bucket, String(m.path), body, contentTypeOf(String(m.path)));
        const file = path.join(scratch, 'object');
        await target.downloadToFile(m.bucket as Bucket, String(m.path), file);
        if (md5Hex(await readFile(file)) !== m.md5) throw new Error('restored object differs from the manifest');
        out.restored++;
        out.bytes += body.length;
      } catch (e) {
        out.failed.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return out;
}

export function restoreChecks(r: StorageRestore): Check[] {
  return [
    verdict('objects restored', [...r.missing.map((k) => `${k} missing off-site`), ...r.failed], `${r.restored} objects uploaded and read back (${(r.bytes / 1_048_576).toFixed(1)} MiB)`),
  ];
}
