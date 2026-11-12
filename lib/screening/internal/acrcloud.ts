import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpeg } from '@/lib/platform/ffmpeg';
import { getEnv } from '@/lib/platform/env';
import type { FingerprintScreener, ScreenMatch, ScreenResult } from '../index';

const SAMPLE_SECONDS = 12;
const SAMPLE_POSITIONS = [0.1, 0.4, 0.7]; // fractions of the track

export type SampleExtractor = (audioFile: string, durationMs: number) => Promise<Buffer[]>;

/** Cuts a few short mono 8 kHz WAV snippets out of the track (the identify API takes short samples). */
export const extractSamples: SampleExtractor = async (audioFile, durationMs) => {
  const work = await mkdtemp(path.join(tmpdir(), 'mrm-screen-'));
  try {
    const out: Buffer[] = [];
    const seconds = durationMs / 1000;
    for (const [i, frac] of SAMPLE_POSITIONS.entries()) {
      const start = Math.max(0, Math.min(seconds * frac, seconds - SAMPLE_SECONDS));
      const file = path.join(work, `s${i}.wav`);
      const r = await runFfmpeg(['-y', '-ss', start.toFixed(2), '-t', String(SAMPLE_SECONDS), '-protocol_whitelist', 'file', '-f', 'mp3', '-i', audioFile, '-ac', '1', '-ar', '8000', file], {
        timeoutMs: 60_000,
      });
      if (r.code !== 0) throw new Error('sample extraction failed');
      out.push(await readFile(file));
    }
    return out;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
};

/** ACRCloud identify signature: base64(HMAC-SHA1(secret, "POST\n/v1/identify\n<key>\naudio\n1\n<timestamp>")). */
export function identifySignature(accessKey: string, accessSecret: string, timestamp: string): string {
  const stringToSign = ['POST', '/v1/identify', accessKey, 'audio', '1', timestamp].join('\n');
  return createHmac('sha1', accessSecret).update(stringToSign).digest('base64');
}

type IdentifyResponse = {
  status?: { code?: number; msg?: string };
  metadata?: { music?: { title?: string; artists?: { name?: string }[]; label?: string; score?: number }[] };
};

export class AcrCloudScreener implements FingerprintScreener {
  readonly id = 'acrcloud';

  constructor(
    private readonly cfg: { host: string; accessKey: string; accessSecret: string },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly samples: SampleExtractor = extractSamples,
  ) {}

  async screen({ audioFile, durationMs }: { audioFile: string; durationMs: number }): Promise<ScreenResult> {
    const matches = new Map<string, ScreenMatch>();
    try {
      for (const sample of await this.samples(audioFile, durationMs)) {
        for (const m of await this.identify(sample)) matches.set(`${m.title}|${m.artist}`.toLowerCase(), m);
      }
    } catch {
      return { status: 'error', matches: [] };
    }
    const list = [...matches.values()];
    return { status: list.length ? 'match' : 'clean', matches: list };
  }

  private async identify(sample: Buffer): Promise<ScreenMatch[]> {
    const { host, accessKey, accessSecret } = this.cfg;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const form = new FormData();
    form.set('access_key', accessKey);
    form.set('data_type', 'audio');
    form.set('signature_version', '1');
    form.set('signature', identifySignature(accessKey, accessSecret, timestamp));
    form.set('timestamp', timestamp);
    form.set('sample_bytes', String(sample.length));
    form.set('sample', new Blob([new Uint8Array(sample)]), 'sample.wav');
    const res = await this.fetchImpl(`https://${host}/v1/identify`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`ACRCloud HTTP ${res.status}`);
    const body = (await res.json()) as IdentifyResponse;
    const code = body.status?.code;
    if (code === 1001) return []; // no result
    if (code !== 0) throw new Error(`ACRCloud error ${code}`);
    return (body.metadata?.music ?? []).map((m) => ({
      title: m.title ?? 'Unknown',
      artist: (m.artists ?? []).map((a) => a.name).filter(Boolean).join(', ') || 'Unknown',
      label: m.label,
      score: m.score,
      source: 'acrcloud' as const,
    }));
  }
}

/** The configured vendor screener, or null when no contract/credentials are in place (F3). */
export function acrCloudFromEnv(): AcrCloudScreener | null {
  const { ACRCLOUD_HOST, ACRCLOUD_ACCESS_KEY, ACRCLOUD_ACCESS_SECRET } = getEnv();
  return ACRCLOUD_HOST && ACRCLOUD_ACCESS_KEY && ACRCLOUD_ACCESS_SECRET
    ? new AcrCloudScreener({ host: ACRCLOUD_HOST, accessKey: ACRCLOUD_ACCESS_KEY, accessSecret: ACRCLOUD_ACCESS_SECRET })
    : null;
}

/** Used when no vendor is live: every track is reported "unavailable" and goes to the manual claim probe. */
export const unavailableScreener: FingerprintScreener = {
  id: 'unavailable',
  async screen() {
    return { status: 'unavailable', matches: [] };
  },
};
