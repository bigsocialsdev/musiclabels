import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { trackVersions } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { md5Hex, offsiteKey, type OffsiteStore } from '@/lib/platform/storage-backup';
import { makeSellableTrack } from '@/tests/factories';
import { sale, setupCommerce } from '@/tests/commerce';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { ObjectNotFoundError, type ObjectStore } from '@/lib/platform/storage';
import { APPEND_ONLY_TABLES, checkDatabase, checkStorageRestore, journalEntryCount, restoreChecks, restoreStorage, storageChecks } from './restore-drill-checks';

afterAll(closeDb);
const db = getDb();
const OBJECTS = 'backup_test.objects';
beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));
beforeEach(async () => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS backup_test`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS backup_test.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL, name text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), metadata jsonb)`);
  await db.execute(sql`TRUNCATE backup_test.objects`);
  await db.execute(sql`TRUNCATE storage_backups`);
});

describe('checkDatabase', () => {
  it('passes the schema checks on a migrated database and names every append-only table it guards', async () => {
    const checks = await checkDatabase(db, { expectedMigrations: journalEntryCount(), licenseSample: 5 });
    const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
    expect(byName.migrations).toMatchObject({ ok: true });
    expect(byName['row-level security']).toMatchObject({ ok: true });
    expect(byName['append-only triggers']).toMatchObject({ ok: true, detail: `${APPEND_ONLY_TABLES.length} append-only tables are guarded` });
    expect(Object.keys(byName)).toEqual(['migrations', 'row-level security', 'append-only triggers', 'gap-free numbering', 'fulfilled orders', 'license record hashes']);
  });

  it('fails when the repository expects more migrations than the restored database has applied', async () => {
    const checks = await checkDatabase(db, { expectedMigrations: journalEntryCount() + 1, licenseSample: 1 });
    expect(checks.find((c) => c.name === 'migrations')).toMatchObject({ ok: false, detail: expect.stringContaining('repository has') });
  });

  it('flags a fulfilled order that lost its invoice, and a numbering series that ran ahead of its documents', async () => {
    const s = await sale(db, new FakeGateway(), new MemoryStore());
    const marker = new Error('rollback');
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = replica`); // lets the test break what the triggers and keys normally protect; rolled back below
        await tx.execute(sql`DELETE FROM invoices WHERE order_id = ${s.orderId}`);
        await tx.execute(sql`INSERT INTO invoice_series (fy, kind, next_number) VALUES ('2099-00', 'invoice', 4) ON CONFLICT DO NOTHING`);
        const checks = await checkDatabase(tx, { expectedMigrations: journalEntryCount(), licenseSample: 1 });
        expect(checks.find((c) => c.name === 'fulfilled orders')).toMatchObject({ ok: false, detail: expect.stringContaining(`order ${s.orderId} lacks its license or invoice`) });
        expect(checks.find((c) => c.name === 'gap-free numbering')).toMatchObject({ ok: false, detail: expect.stringContaining('invoice 2099-00: 3 numbers allocated, 0 issued') });
        throw marker;
      })
      .catch((e) => {
        if (e !== marker) throw e;
      });
  });
});

describe('checkStorageRestore', () => {
  const master = Buffer.from('wav-bytes-of-a-master');
  const offsiteWith = (objects: Record<string, Buffer>): OffsiteStore => ({ put: async () => ({ md5: '' }), get: async (k) => objects[k] ?? null });
  async function manifest(bucket: string, path: string, body: Buffer, md5 = md5Hex(body)) {
    await db.execute(sql`INSERT INTO storage_backups (bucket, path, source_updated_at, size_bytes, md5) VALUES (${bucket}, ${path}, now(), ${body.length}, ${md5})`);
  }

  it('reads every manifest object back and confirms MD5 and, for masters, the SHA-256 the database holds', async () => {
    const t = await makeSellableTrack(db);
    const path = `drill/${t.trackId}/master.wav`;
    await db.update(trackVersions).set({ masterKey: path, masterSha256: createHash('sha256').update(master).digest('hex') }).where(eq(trackVersions.id, t.trackVersionId));
    await manifest('masters', path, master);
    await manifest('pdfs', 'o/invoice.pdf', Buffer.from('pdf'));
    const result = await checkStorageRestore(db, offsiteWith({ [offsiteKey('masters', path)]: master, [offsiteKey('pdfs', 'o/invoice.pdf')]: Buffer.from('pdf') }), { objectsTable: OBJECTS });
    expect(result).toMatchObject({ objects: 2, missing: [], corrupt: [], masterMismatch: [], notBackedUp: 0 });
    expect(storageChecks(result).every((c) => c.ok)).toBe(true);
  });

  it('reports a missing object, a corrupted one, a master that differs from the database, and Storage objects with no copy', async () => {
    const t = await makeSellableTrack(db);
    const path = `drill/${t.trackId}/master.wav`;
    await db.update(trackVersions).set({ masterKey: path, masterSha256: createHash('sha256').update('something else').digest('hex') }).where(eq(trackVersions.id, t.trackVersionId));
    await manifest('masters', path, master);
    await manifest('documents', 'gone.pdf', Buffer.from('x'));
    await manifest('pdfs', 'rot.pdf', Buffer.from('good'));
    await db.execute(sql`INSERT INTO backup_test.objects (bucket_id, name) VALUES ('masters', 'uncovered.wav')`);
    const result = await checkStorageRestore(db, offsiteWith({ [offsiteKey('masters', path)]: master, [offsiteKey('pdfs', 'rot.pdf')]: Buffer.from('bad!') }), { objectsTable: OBJECTS });
    expect(result).toMatchObject({ objects: 2, missing: ['documents/gone.pdf'], corrupt: ['pdfs/rot.pdf'], masterMismatch: [`masters/${path}`], notBackedUp: 1 });
    expect(storageChecks(result).filter((c) => !c.ok).map((c) => c.name)).toEqual(['off-site objects present', 'off-site objects intact', 'masters match the database', 'backup is current']);
  });

  it('can check a random sample instead of everything', async () => {
    for (const n of [1, 2, 3, 4]) await manifest('pdfs', `s/${n}.pdf`, Buffer.from(String(n)));
    const result = await checkStorageRestore(db, offsiteWith({}), { sample: 2, objectsTable: OBJECTS });
    expect(result.missing).toHaveLength(2);
  });
});

describe('restoreStorage', () => {
  const bodies: Record<string, Buffer> = { 'masters/m/a.wav': Buffer.from('audio'), 'pdfs/o/invoice.pdf': Buffer.from('invoice'), 'documents/d/gone.pdf': Buffer.from('lost') };
  const offsite: OffsiteStore = { put: async () => ({ md5: '' }), get: async (k) => (k === 'documents/d/gone.pdf' ? null : (bodies[k] ?? null)) };
  function target(opts: { corrupt?: string } = {}) {
    const held = new Map<string, { data: Buffer; type: string }>();
    const store: ObjectStore = {
      async upload(bucket, path, data, type) {
        held.set(`${bucket}/${path}`, { data: opts.corrupt === path ? Buffer.from('garbled') : data, type });
      },
      async downloadToFile(bucket, path, dest) {
        const o = held.get(`${bucket}/${path}`);
        if (!o) throw new ObjectNotFoundError(bucket, path);
        await (await import('node:fs/promises')).writeFile(dest, o.data);
      },
    };
    return { store, held };
  }
  async function manifestAll() {
    for (const [key, body] of Object.entries(bodies)) {
      const [bucket, ...rest] = key.split('/');
      await db.execute(sql`INSERT INTO storage_backups (bucket, path, source_updated_at, size_bytes, md5) VALUES (${bucket!}, ${rest.join('/')}, now(), ${body.length}, ${md5Hex(body)})`);
    }
  }

  it('uploads each off-site copy with a content type, reads it back, and reports what is missing off-site', async () => {
    await manifestAll();
    const t = target();
    const r = await restoreStorage(db, offsite, t.store);
    expect(r).toMatchObject({ restored: 2, missing: ['documents/d/gone.pdf'], failed: [] });
    expect(t.held.get('pdfs/o/invoice.pdf')).toMatchObject({ type: 'application/pdf' });
    expect(t.held.get('masters/m/a.wav')).toMatchObject({ type: 'audio/wav' });
    expect(restoreChecks(r)[0]).toMatchObject({ ok: false, detail: expect.stringContaining('documents/d/gone.pdf missing off-site') });
  });

  it('fails an object whose restored copy does not read back as recorded', async () => {
    await manifestAll();
    const r = await restoreStorage(db, offsite, target({ corrupt: 'o/invoice.pdf' }).store);
    expect(r.restored).toBe(1);
    expect(r.failed).toEqual([expect.stringContaining('pdfs/o/invoice.pdf: restored object differs from the manifest')]);
  });
});
