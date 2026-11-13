import { writeFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { storageBackups } from '@/db/schema';
import { closeDb, getDb } from './db';
import { r2OffsiteStore } from './offsite-r2';
import { ObjectNotFoundError, type ObjectStore } from './storage';
import { backupStorage, md5Hex, offsiteKey, type OffsiteStore } from './storage-backup';

afterAll(closeDb);
afterEach(() => vi.unstubAllGlobals());
const db = getDb();

// Supabase's storage schema comes from the Storage service, which the test database does not run: stand in for the one table we read.
beforeEach(async () => {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS storage`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL, name text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), metadata jsonb)`);
  await db.execute(sql`TRUNCATE storage.objects`);
  await db.execute(sql`TRUNCATE storage_backups`);
});

const objects = new Map<string, Buffer>(); // `${bucket}/${path}` in Supabase Storage
const source: ObjectStore = {
  async downloadToFile(bucket, path, dest) {
    const data = objects.get(offsiteKey(bucket, path));
    if (!data) throw new ObjectNotFoundError(bucket, path);
    await writeFile(dest, data);
  },
  async upload() {},
};
function offsite(opts: { lieAbout?: string; failOn?: string } = {}) {
  const stored = new Map<string, Buffer>();
  const store: OffsiteStore = {
    async put(key, body) {
      if (opts.failOn && key.includes(opts.failOn)) throw new Error('bucket unreachable');
      stored.set(key, body);
      return { md5: opts.lieAbout && key.includes(opts.lieAbout) ? '0'.repeat(32) : md5Hex(body) };
    },
    async get(key) {
      return stored.get(key) ?? null;
    },
  };
  return { store, stored };
}
async function put(bucket: string, path: string, content: string, updatedAt = new Date()) {
  objects.set(offsiteKey(bucket, path), Buffer.from(content));
  await db.execute(sql`INSERT INTO storage.objects (bucket_id, name, updated_at, metadata) VALUES (${bucket}, ${path}, ${updatedAt.toISOString()}::timestamptz, ${JSON.stringify({ mimetype: 'application/octet-stream' })}::jsonb)`);
}

describe('backupStorage', () => {
  it('copies new objects of the backed-up buckets, confirms each by MD5, records them, and skips previews and folder placeholders', async () => {
    await put('masters', 'org/track/v1.wav', 'master-bytes');
    await put('documents', 'org/track/docs/a.pdf', 'rights-doc');
    await put('pdfs', 'orders/o1/invoice.pdf', 'invoice');
    await put('previews', 'track/preview.mp3', 'derived');
    await put('pdfs', 'orders/.emptyFolderPlaceholder', '');
    const off = offsite();

    expect(await backupStorage(db, { store: source, offsite: off.store })).toEqual({ copied: 3, bytes: 'master-bytes'.length + 'rights-doc'.length + 'invoice'.length, failed: 0, remaining: 0 });
    expect([...off.stored.keys()].sort()).toEqual(['documents/org/track/docs/a.pdf', 'masters/org/track/v1.wav', 'pdfs/orders/o1/invoice.pdf']);
    const [m] = await db.select().from(storageBackups).where(eq(storageBackups.path, 'org/track/v1.wav'));
    expect(m).toMatchObject({ bucket: 'masters', sizeBytes: 12, md5: md5Hex(Buffer.from('master-bytes')) });
  });

  it('is idempotent, and copies an object again only when it changed', async () => {
    const t0 = new Date(Date.now() - 60_000);
    await put('masters', 'a.wav', 'one', t0);
    const off = offsite();
    await backupStorage(db, { store: source, offsite: off.store });
    expect(await backupStorage(db, { store: source, offsite: off.store })).toMatchObject({ copied: 0, remaining: 0 });

    objects.set('masters/a.wav', Buffer.from('two!'));
    await db.execute(sql`UPDATE storage.objects SET updated_at = now() WHERE name = 'a.wav'`);
    expect(await backupStorage(db, { store: source, offsite: off.store })).toMatchObject({ copied: 1 });
    expect(off.stored.get('masters/a.wav')!.toString()).toBe('two!');
    const [m] = await db.select().from(storageBackups).where(eq(storageBackups.path, 'a.wav'));
    expect(m).toMatchObject({ sizeBytes: 4, md5: md5Hex(Buffer.from('two!')) });
  });

  it('records nothing for an object whose off-site MD5 differs, still copies the others, and fails the run', async () => {
    await put('masters', 'good.wav', 'good');
    await put('masters', 'bad.wav', 'bad');
    const off = offsite({ lieAbout: 'bad.wav' });
    await expect(backupStorage(db, { store: source, offsite: off.store })).rejects.toThrow(/1 of 2 objects failed \(1 copied, 1 still pending\).*bad\.wav.*differs/);
    expect((await db.select().from(storageBackups)).map((r) => r.path)).toEqual(['good.wav']);
    // the failed object stays pending and is retried
    expect(await backupStorage(db, { store: source, offsite: offsite().store })).toMatchObject({ copied: 1, remaining: 0 });
  });

  it('fails the run when the off-site store or the source cannot be reached', async () => {
    await put('pdfs', 'x.pdf', 'x');
    await expect(backupStorage(db, { store: source, offsite: offsite({ failOn: 'x.pdf' }).store })).rejects.toThrow(/bucket unreachable/);
    objects.delete('pdfs/x.pdf');
    await expect(backupStorage(db, { store: source, offsite: offsite().store })).rejects.toThrow(/Object not found/);
    expect(await db.select().from(storageBackups)).toHaveLength(0);
  });

  it('stops starting new objects once its time budget is spent and reports what is left', async () => {
    await put('masters', 'one.wav', '1');
    await put('masters', 'two.wav', '2');
    expect(await backupStorage(db, { store: source, offsite: offsite().store, budgetMs: -1 })).toEqual({ copied: 0, bytes: 0, failed: 0, remaining: 2 });
    expect(await backupStorage(db, { store: source, offsite: offsite().store, maxObjects: 1 })).toMatchObject({ copied: 1, remaining: 1 });
  });
});

describe('r2OffsiteStore', () => {
  const env = { BACKUP_S3_ENDPOINT: 'https://acct.r2.cloudflarestorage.com', BACKUP_S3_BUCKET: 'mrm-backup', BACKUP_S3_ACCESS_KEY_ID: 'AKIA', BACKUP_S3_SECRET_ACCESS_KEY: 'secret' };

  it('refuses to start until all four settings are present', () => {
    expect(() => r2OffsiteStore({ ...env, BACKUP_S3_BUCKET: undefined })).toThrow(/not configured/);
  });

  it('signs a PUT to the bucket path and returns the ETag as the MD5, and reads a missing object as null', async () => {
    const calls: Request[] = [];
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      calls.push(req);
      if (req.method === 'PUT') return new Response(null, { status: 200, headers: { etag: `"${md5Hex(Buffer.from('hello'))}"` } });
      return new Response('nope', { status: 404 });
    });
    const store = r2OffsiteStore(env);
    expect(await store.put('masters/org/my track.wav', Buffer.from('hello'), 'audio/wav')).toEqual({ md5: md5Hex(Buffer.from('hello')) });
    expect(calls[0]!.url).toBe('https://acct.r2.cloudflarestorage.com/mrm-backup/masters/org/my%20track.wav');
    expect(calls[0]!.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA\/\d{8}\/auto\/s3\/aws4_request/);
    expect(await store.get('masters/gone.wav')).toBeNull();
  });

  it('throws on a failed upload', async () => {
    vi.stubGlobal('fetch', async () => new Response('denied', { status: 403 }));
    await expect(r2OffsiteStore(env).put('k', Buffer.from('x'))).rejects.toThrow(/403/);
  });
});
