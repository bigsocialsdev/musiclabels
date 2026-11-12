import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { runFfmpeg, streamFfmpeg } from '@/lib/platform/ffmpeg';

export const MIN_DURATION_MS = 15_000;
export const MAX_DURATION_MS = 15 * 60_000;
export const MIN_SAMPLE_RATE = 44_100;
export const WAVEFORM_BUCKETS = 800;

export type Probe = { format: 'wav' | 'mp3'; durationMs: number; sampleRate: number };

/** Thrown for problems the seller can fix (shown to them); anything else is a generic processing failure. */
export class MediaRejectedError extends Error {}

/**
 * Input arguments for a seller-supplied file. ffmpeg otherwise auto-detects the container from the CONTENT, and
 * playlist-style formats (HLS, concat) can make it read local files or fetch URLs. So the demuxer is forced from
 * the extension we assigned (wav or mp3, validated at upload) and only the plain file protocol is allowed.
 */
export function untrustedInput(file: string): string[] {
  const ext = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase();
  if (ext !== 'wav' && ext !== 'mp3') throw new MediaRejectedError('File is not a valid WAV or MP3 audio file');
  return ['-protocol_whitelist', 'file', '-f', ext, '-i', file];
}

/**
 * ffmpeg-static ships no ffprobe, so the file is probed with `ffmpeg -i` (exit code 1 is expected:
 * there is no output file) and the stream summary parsed from stderr. Also acts as the decode sanity check.
 */
export async function probeAudio(file: string): Promise<Probe> {
  const { stderr } = await runFfmpeg([...untrustedInput(file)], { timeoutMs: 60_000 });
  return parseProbe(stderr);
}

export function parseProbe(stderr: string): Probe {
  const input = /Input #0, ([^,]+(?:,[^,]+)*?), from /.exec(stderr)?.[1] ?? '';
  const formats = input.split(',').map((s) => s.trim());
  const format = formats.includes('wav') ? 'wav' : formats.includes('mp3') ? 'mp3' : null;
  if (!format) throw new MediaRejectedError('File is not a valid WAV or MP3 audio file');

  const audio = /Stream #0:\d+[^:]*: Audio: .*?, (\d+) Hz/.exec(stderr);
  if (!audio) throw new MediaRejectedError('No audio stream found in the file');
  const sampleRate = Number(audio[1]);

  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!d) throw new MediaRejectedError('Could not read the duration of the file');
  const durationMs = Math.round((Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])) * 1000);

  if (durationMs < MIN_DURATION_MS) throw new MediaRejectedError('Track is shorter than 15 seconds');
  if (durationMs > MAX_DURATION_MS) throw new MediaRejectedError('Track is longer than 15 minutes');
  if (sampleRate < MIN_SAMPLE_RATE) throw new MediaRejectedError('Sample rate must be at least 44.1 kHz');
  return { format, durationMs, sampleRate };
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

async function mustSucceed(args: string[], what: string, timeoutMs?: number) {
  const { code, stderr } = await runFfmpeg(args, { timeoutMs });
  if (code !== 0) throw new Error(`ffmpeg failed (${what}): ${stderr.slice(-500)}`);
}

/**
 * Audible-tag preview (rendered once at ingest, deterrent only, not forensic): the track mixed with a
 * short beep every second, as a 128 kbps MP3 with metadata stripped.
 */
export function renderPreview(src: string, dest: string) {
  const filter =
    '[1:a]volume=0.35[tag];[0:a][tag]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]';
  return mustSucceed(
    ['-y', ...untrustedInput(src), '-f', 'lavfi', '-i', 'sine=frequency=880:beep_factor=4', '-filter_complex', filter, '-map', '[out]',
      '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', dest],
    'preview',
  );
}

/** Clean 320 kbps MP3 derivative handed to buyers after purchase. */
export function renderMp3(src: string, dest: string) {
  return mustSucceed(['-y', ...untrustedInput(src), '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '320k', dest], 'mp3');
}

/** Peak amplitude (0..1, three decimals) for each of `buckets` equal slices of the track. */
export async function waveformPeaks(src: string, durationMs: number, buckets = WAVEFORM_BUCKETS): Promise<number[]> {
  const RATE = 8000; // mono, signed 16-bit: plenty for a visual envelope
  const total = Math.max(1, Math.round((durationMs / 1000) * RATE));
  const perBucket = Math.ceil(total / buckets);
  const peaks = new Array<number>(buckets).fill(0);
  let index = 0;
  let carry: Buffer = Buffer.alloc(0);
  const { code, stderr } = await streamFfmpeg([...untrustedInput(src), '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], (chunk) => {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const usable = buf.length - (buf.length % 2);
    for (let o = 0; o < usable; o += 2) {
      const b = Math.min(buckets - 1, Math.floor(index / perBucket));
      const v = Math.abs(buf.readInt16LE(o)) / 32768;
      if (v > peaks[b]!) peaks[b] = v;
      index++;
    }
    carry = buf.subarray(usable);
  });
  if (code !== 0) throw new Error(`ffmpeg failed (waveform): ${stderr.slice(-500)}`);
  return peaks.map((p) => Math.round(p * 1000) / 1000);
}
