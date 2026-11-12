import 'server-only';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getSupabaseAdmin } from './supabase';

/** Private buckets. Files leave only through short-lived signed URLs. */
export const BUCKETS = {
  masters: 'masters',
  previews: 'previews',
  documents: 'documents',
  pdfs: 'pdfs',
} as const;
export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

/** Signed URL the client uploads to directly (valid ~2 h, single path). */
export async function createSignedUploadUrl(bucket: Bucket, path: string) {
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).createSignedUploadUrl(path);
  if (error) throw new Error(`Storage upload URL failed: ${error.message}`);
  return data;
}

/** Short-lived download URL (previews 10 min, downloads 15 min per PLAN section 10). */
export async function createSignedDownloadUrl(bucket: Bucket, path: string, expiresInSeconds: number, downloadName?: string) {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, expiresInSeconds, downloadName ? { download: downloadName } : undefined);
  if (error) throw new Error(`Storage download URL failed: ${error.message}`);
  return data.signedUrl;
}

/** Server-side object access used by background handlers. Handlers take this so tests can substitute a local fake. */
export interface ObjectStore {
  /** Streams the object to a local file. Throws ObjectNotFoundError when it does not exist. */
  downloadToFile(bucket: Bucket, path: string, destFile: string): Promise<void>;
  upload(bucket: Bucket, path: string, data: Buffer, contentType: string): Promise<void>;
}

export class ObjectNotFoundError extends Error {
  constructor(bucket: string, path: string) {
    super(`Object not found: ${bucket}/${path}`);
  }
}

export const supabaseObjectStore: ObjectStore = {
  async downloadToFile(bucket, path, destFile) {
    const url = await createSignedDownloadUrl(bucket, path, 300).catch(() => {
      throw new ObjectNotFoundError(bucket, path);
    });
    const res = await fetch(url);
    if (res.status === 400 || res.status === 404) throw new ObjectNotFoundError(bucket, path);
    if (!res.ok || !res.body) throw new Error(`Storage download failed (${res.status})`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destFile));
  },
  async upload(bucket, path, data, contentType) {
    const { error } = await getSupabaseAdmin().storage.from(bucket).upload(path, data, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  },
};
