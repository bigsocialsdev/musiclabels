import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { trackVersions } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { runFfmpeg } from '@/lib/platform/ffmpeg';
import { ObjectNotFoundError, type ObjectStore } from '@/lib/platform/storage';
import { makeSeller, makeTrack } from '@/tests/factories';
import { derivedKeys, ingestVersion } from './internal/ingest';
import { parseProbe } from './internal/media';

const db = getDb();
let dir: string;
let sourceDir: string;
const uploaded = new Map<string, Buffer>();

/** Local fake of Supabase Storage: "uploaded" sources live in sourceDir; outputs land in a map. */
const store: ObjectStore = {
  async downloadToFile(bucket, key, dest) {
    const src = path.join(sourceDir, `${bucket}__${key.replaceAll('/', '_')}`);
    try {
      await copyFile(src, dest);
    } catch {
      throw new ObjectNotFoundError(bucket, key);
    }
  },
  async upload(bucket, key, data) {
    uploaded.set(`${bucket}/${key}`, data);
  },
};

async function putMaster(key: string, file: string) {
  await copyFile(file, path.join(sourceDir, `masters__${key.replaceAll('/', '_')}`));
}

async function sine(file: string, seconds: number, rate = 44100) {
  const r = await runFfmpeg(['-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-ar', String(rate), '-ac', '2', file]);
  expect(r.code).toBe(0);
}

async function newVersion(masterKey: string) {
  const { orgId } = await makeSeller(db);
  const trackId = await makeTrack(db, orgId);
  const [v] = await db
    .insert(trackVersions)
    .values({ trackId, versionNo: 1, masterKey })
    .returning({ id: trackVersions.id });
  return v!.id;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mrm-test-'));
  sourceDir = await mkdtemp(path.join(tmpdir(), 'mrm-src-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(sourceDir, { recursive: true, force: true });
  await closeDb();
});

const keyFor = (name: string) => `org-${name}/track-${name}/${name}.wav`;
const row = async (id: string) => (await db.select().from(trackVersions).where(eq(trackVersions.id, id)))[0]!;

describe('ingestVersion', () => {
  it('produces preview, mp3 derivative, waveform and metadata for a valid WAV', async () => {
    const key = keyFor(`ok${Date.now()}`);
    const wav = path.join(dir, 'ok.wav');
    await sine(wav, 20);
    await putMaster(key, wav);
    const id = await newVersion(key);

    expect(await ingestVersion(id, store)).toBe('ready');

    const v = await row(id);
    expect(v).toMatchObject({ ingestStatus: 'ready', ingestError: null, masterFormat: 'wav', sampleRate: 44100 });
    expect(v.durationMs).toBeGreaterThan(19_900);
    expect(v.durationMs).toBeLessThan(20_200);
    expect(v.masterSha256).toBe(createHash('sha256').update(readFileSync(wav)).digest('hex'));
    const keys = derivedKeys(key);
    expect(v).toMatchObject({ previewKey: keys.preview, previewDownloadKey: keys.preview, mp3DerivativeKey: keys.mp3, waveformKey: keys.waveform });

    const preview = uploaded.get(`previews/${keys.preview}`)!;
    const mp3 = uploaded.get(`masters/${keys.mp3}`)!;
    expect(preview.length).toBeGreaterThan(1000);
    expect(mp3.length).toBeGreaterThan(preview.length); // 320k vs 128k
    const peaks = JSON.parse(uploaded.get(`previews/${keys.waveform}`)!.toString()).peaks as number[];
    expect(peaks).toHaveLength(800);
    expect(Math.max(...peaks)).toBeGreaterThan(0.05);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1);
  });

  it('the preview carries the audible tag (differs from a plain encode)', async () => {
    const key = keyFor(`tag${Date.now()}`);
    const wav = path.join(dir, 'tag.wav');
    await sine(wav, 20);
    await putMaster(key, wav);
    const id = await newVersion(key);
    await ingestVersion(id, store);
    const preview = uploaded.get(`previews/${derivedKeys(key).preview}`)!;

    // Measure the loudest 100 ms window of each: the tag adds a beep on top of the steady tone.
    const previewFile = path.join(dir, 'tag-preview.mp3');
    await writeFile(previewFile, preview);
    const plain = path.join(dir, 'tag-plain.mp3');
    await runFfmpeg(['-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', plain]);
    const peak = async (f: string) => {
      const r = await runFfmpeg(['-i', f, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-']);
      return Number(/Peak level dB: (-?\d+\.\d+)/.exec(r.stderr)?.[1] ?? NaN);
    };
    expect(Math.abs((await peak(previewFile)) - (await peak(plain)))).toBeGreaterThan(0.01);
    expect(preview.equals(await readFile(plain))).toBe(false);
  });

  it('rejects a track shorter than 15 seconds with a seller-visible reason', async () => {
    const key = keyFor(`short${Date.now()}`);
    const wav = path.join(dir, 'short.wav');
    await sine(wav, 5);
    await putMaster(key, wav);
    const id = await newVersion(key);
    expect(await ingestVersion(id, store)).toBe('failed');
    expect(await row(id)).toMatchObject({ ingestStatus: 'failed', ingestError: 'Track is shorter than 15 seconds' });
  });

  it('rejects a low sample rate', async () => {
    const key = keyFor(`lowsr${Date.now()}`);
    const wav = path.join(dir, 'lowsr.wav');
    await sine(wav, 20, 22050);
    await putMaster(key, wav);
    const id = await newVersion(key);
    expect(await ingestVersion(id, store)).toBe('failed');
    expect((await row(id)).ingestError).toMatch(/44\.1 kHz/);
  });

  it('rejects a non-audio file renamed to .wav', async () => {
    const key = keyFor(`fake${Date.now()}`);
    const exe = path.join(dir, 'fake.wav');
    await writeFile(exe, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(5000, 7)]));
    await putMaster(key, exe);
    const id = await newVersion(key);
    expect(await ingestVersion(id, store)).toBe('failed');
    expect((await row(id)).ingestError).toMatch(/not a valid WAV or MP3/);
  });

  it('fails cleanly when the uploaded object is missing', async () => {
    const id = await newVersion(keyFor(`missing${Date.now()}`));
    expect(await ingestVersion(id, store)).toBe('failed');
    expect((await row(id)).ingestError).toMatch(/not found/);
  });

  it('two concurrent runs process the version once; a finished version is skipped', async () => {
    const key = keyFor(`race${Date.now()}`);
    const wav = path.join(dir, 'race.wav');
    await sine(wav, 16);
    await putMaster(key, wav);
    const id = await newVersion(key);
    const results = await Promise.all([ingestVersion(id, store), ingestVersion(id, store)]);
    expect(results.sort()).toEqual(['ready', 'skipped']);
    expect(await ingestVersion(id, store)).toBe('skipped');
  });

  it('reclaims a version stuck in processing after a crash', async () => {
    const key = keyFor(`stale${Date.now()}`);
    const wav = path.join(dir, 'stale.wav');
    await sine(wav, 16);
    await putMaster(key, wav);
    const id = await newVersion(key);
    await db.execute(sql`UPDATE track_versions SET ingest_status = 'processing', claimed_at = now() - interval '11 minutes' WHERE id = ${id}`);
    expect(await ingestVersion(id, store)).toBe('ready');
  });
});

describe('parseProbe', () => {
  it('reads wav and mp3 summaries and enforces bounds', () => {
    const wav = `Input #0, wav, from 'x.wav':\n  Duration: 00:03:21.45, bitrate: 1411 kb/s\n  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, 2 channels, s16, 1536 kb/s`;
    expect(parseProbe(wav)).toEqual({ format: 'wav', durationMs: 201_450, sampleRate: 48000 });
    const mp3 = `Input #0, mp3, from 'x.mp3':\n  Duration: 00:00:30.02, start: 0.025057, bitrate: 320 kb/s\n  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s`;
    expect(parseProbe(mp3)).toMatchObject({ format: 'mp3', sampleRate: 44100 });
    expect(() => parseProbe(wav.replace('00:03:21.45', '00:16:00.00'))).toThrow(/longer than 15 minutes/);
    expect(() => parseProbe(`Input #0, ogg, from 'x':\n Duration: 00:01:00.00\n Stream #0:0: Audio: vorbis, 44100 Hz`)).toThrow(/WAV or MP3/);
  });
});

// Opt-in timing check for the Vercel function limit: INGEST_STRESS=1 npm test -- ingest
describe.skipIf(!process.env.INGEST_STRESS)('15-minute WAV (stress)', () => {
  it('ingests inside the 300 s function budget', async () => {
    const key = keyFor(`long${Date.now()}`);
    const wav = path.join(dir, 'long.wav');
    await sine(wav, 15 * 60 - 1);
    await putMaster(key, wav);
    const id = await newVersion(key);
    const t0 = Date.now();
    expect(await ingestVersion(id, store)).toBe('ready');
    const seconds = (Date.now() - t0) / 1000;
    console.log(`15-min WAV ingest took ${seconds.toFixed(1)} s`);
    expect(seconds).toBeLessThan(300);
  }, 320_000);
});
