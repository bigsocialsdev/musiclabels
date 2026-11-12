import 'server-only';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

export function ffmpegPath(): string {
  const p = process.env.FFMPEG_PATH ?? ffmpegStatic;
  if (!p) throw new Error('ffmpeg binary not available');
  return p;
}

export type RunResult = { code: number | null; stderr: string };

const STDERR_CAP = 64 * 1024;

/** Runs ffmpeg with a hard timeout. Resolves with the exit code and (capped) stderr; never rejects on a non-zero exit. */
export function runFfmpeg(args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += d.toString('latin1');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 240_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/** Runs ffmpeg and streams its stdout to `onData` (used to compute waveform peaks without temp files). */
export function streamFfmpeg(args: string[], onData: (chunk: Buffer) => void, opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.on('data', onData);
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += d.toString('latin1');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 240_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}
