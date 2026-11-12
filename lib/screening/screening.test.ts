import { afterAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, screenings, trackVersions } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { runFfmpeg } from '@/lib/platform/ffmpeg';
import { ObjectNotFoundError, type ObjectStore } from '@/lib/platform/storage';
import { makeSeller, makeTrack, makeUser } from '@/tests/factories';
import { AcrCloudScreener, identifySignature, recordClaimProbe, getReviewFacts, screenVersion, type FingerprintScreener } from './server';

afterAll(closeDb);
const db = getDb();

const store: ObjectStore = {
  async downloadToFile(_b, _k, dest) {
    const src = (globalThis as { __audio?: string }).__audio;
    if (!src) throw new ObjectNotFoundError('masters', 'x');
    await copyFile(src, dest);
  },
  async upload() {},
};

async function readyVersion(opts: { sha?: string; trackOrg?: string } = {}) {
  const orgId = opts.trackOrg ?? (await makeSeller(db)).orgId;
  const trackId = await makeTrack(db, orgId);
  const [v] = await db
    .insert(trackVersions)
    .values({
      trackId,
      versionNo: 1,
      masterKey: `k/${crypto.randomUUID()}.wav`,
      masterSha256: opts.sha ?? crypto.randomUUID().replaceAll('-', ''),
      ingestStatus: 'ready',
      durationMs: 30_000,
      mp3DerivativeKey: `k/${crypto.randomUUID()}.320.mp3`,
    })
    .returning({ id: trackVersions.id });
  return v!.id;
}

const fake = (status: 'clean' | 'match' | 'error', calls = { n: 0 }): FingerprintScreener => ({
  id: 'fake',
  async screen() {
    calls.n++;
    if (status === 'error') return { status: 'error', matches: [] };
    return status === 'match'
      ? { status: 'match', matches: [{ title: 'Famous Song', artist: 'Famous Artist', label: 'Big Label', score: 100, source: 'acrcloud' }] }
      : { status: 'clean', matches: [] };
  },
});

(globalThis as { __audio?: string }).__audio = undefined;
async function withAudio() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mrm-scr-'));
  const f = path.join(dir, 'a.mp3');
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=2', f]);
  (globalThis as { __audio?: string }).__audio = f;
  return () => rm(dir, { recursive: true, force: true });
}

describe('screenVersion', () => {
  it('records clean and match results from the vendor', async () => {
    const cleanup = await withAudio();
    const a = await readyVersion();
    const b = await readyVersion();
    expect(await screenVersion(a, { screener: fake('clean'), store })).toBe('clean');
    expect(await screenVersion(b, { screener: fake('match'), store })).toBe('match');
    const [row] = await db.select().from(screenings).where(eq(screenings.trackVersionId, b));
    expect(row).toMatchObject({ provider: 'fake', status: 'match' });
    expect(row!.matches).toEqual([{ title: 'Famous Song', artist: 'Famous Artist', label: 'Big Label', score: 100, source: 'acrcloud' }]);
    await cleanup();
  });

  it('reports "unavailable" when no vendor is configured (manual probe is then the only check)', async () => {
    const cleanup = await withAudio();
    const id = await readyVersion();
    expect(await screenVersion(id, { store })).toBe('unavailable');
    expect((await getReviewFacts(db, id)).screening).toMatchObject({ provider: 'unavailable', status: 'unavailable' });
    await cleanup();
  });

  it('flags the same audio uploaded under another track (cross-seller duplicate) even when the vendor says clean', async () => {
    const cleanup = await withAudio();
    const sha = `dup-${crypto.randomUUID()}`;
    await readyVersion({ sha });
    const second = await readyVersion({ sha });
    expect(await screenVersion(second, { screener: fake('clean'), store })).toBe('match');
    const facts = await getReviewFacts(db, second);
    expect(facts.screening?.matches[0]).toMatchObject({ source: 'internal_duplicate', title: 'Test Track' });
    await cleanup();
  });

  it('is idempotent: concurrent runs call the vendor once, finished versions are skipped', async () => {
    const cleanup = await withAudio();
    const id = await readyVersion();
    const calls = { n: 0 };
    const results = await Promise.all([screenVersion(id, { screener: fake('clean', calls), store }), screenVersion(id, { screener: fake('clean', calls), store })]);
    expect(results.sort()).toEqual(['clean', 'skipped']);
    expect(calls.n).toBe(1);
    expect(await screenVersion(id, { screener: fake('clean', calls), store })).toBe('skipped');
    await cleanup();
  });

  it('retries after an error and skips versions that are not ingested yet', async () => {
    const cleanup = await withAudio();
    const id = await readyVersion();
    expect(await screenVersion(id, { screener: fake('error'), store })).toBe('error');
    expect(await screenVersion(id, { screener: fake('clean'), store })).toBe('clean');
    await db.execute(sql`UPDATE track_versions SET ingest_status = 'pending' WHERE id = ${id}`);
    const other = await readyVersion();
    await db.execute(sql`UPDATE track_versions SET ingest_status = 'pending' WHERE id = ${other}`);
    expect(await screenVersion(other, { screener: fake('clean'), store })).toBe('not_ready');
    await cleanup();
  });
});

describe('claim probes', () => {
  it('needs the verification permission, stores the observed claims and audits', async () => {
    const id = await readyVersion();
    const finance = await makeUser(db, { admin: ['finance'], aal: 'aal2' });
    await expect(
      recordClaimProbe(db, { userId: finance.userId, permissions: ['finance'] }, { versionId: id, platform: 'youtube', claims: [] }),
    ).rejects.toThrow(/verification/);

    const admin = await makeUser(db, { admin: ['verification'], aal: 'aal2' });
    const probeId = await recordClaimProbe(
      db,
      { userId: admin.userId, permissions: ['verification'] },
      { versionId: id, platform: 'youtube', claims: [{ claimant: 'Some Label', policy: 'monetize' }], notes: 'private upload on test channel' },
    );
    const facts = await getReviewFacts(db, id);
    expect(facts.probes).toHaveLength(1);
    expect(facts.probes[0]).toMatchObject({ id: probeId, platform: 'youtube', claims: [{ claimant: 'Some Label', policy: 'monetize' }] });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'claim_probe.record')));
    expect(audits).toHaveLength(1);
  });
});

describe('AcrCloudScreener', () => {
  const cfg = { host: 'identify-eu-west-1.acrcloud.com', accessKey: 'key', accessSecret: 'secret' };
  const samples = async () => [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')];
  const respond = (...bodies: object[]) => {
    let i = 0;
    const calls: { url: string; form: FormData }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, form: init.body as FormData });
      return new Response(JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]), { status: 200 });
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it('signs requests with HMAC-SHA1 over the documented string', () => {
    expect(identifySignature('k', 's', '1700000000')).toBe(
      'Rz0v9Nh+ugLrHX8ccNBeybc9ck4=', // base64(hmac_sha1("s", "POST\n/v1/identify\nk\naudio\n1\n1700000000"))
    );
  });

  it('maps music results to matches and de-duplicates across samples', async () => {
    const hit = { status: { code: 0 }, metadata: { music: [{ title: 'Song', artists: [{ name: 'A' }, { name: 'B' }], label: 'L', score: 92 }] } };
    const { f, calls } = respond(hit, { status: { code: 1001 } }, hit);
    const r = await new AcrCloudScreener(cfg, f, samples).screen({ audioFile: 'x', durationMs: 60_000 });
    expect(r).toEqual({ status: 'match', matches: [{ title: 'Song', artist: 'A, B', label: 'L', score: 92, source: 'acrcloud' }] });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url).toBe('https://identify-eu-west-1.acrcloud.com/v1/identify');
    expect(calls[0]!.form.get('access_key')).toBe('key');
    expect(calls[0]!.form.get('signature_version')).toBe('1');
  });

  it('reports clean when nothing is recognised and error on vendor failures', async () => {
    const none = respond({ status: { code: 1001 } });
    expect(await new AcrCloudScreener(cfg, none.f, samples).screen({ audioFile: 'x', durationMs: 60_000 })).toEqual({ status: 'clean', matches: [] });
    const bad = respond({ status: { code: 3001 } });
    expect((await new AcrCloudScreener(cfg, bad.f, samples).screen({ audioFile: 'x', durationMs: 60_000 })).status).toBe('error');
  });
});
