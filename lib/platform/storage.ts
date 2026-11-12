import 'server-only';
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

/** Short-lived download URL (previews 10 min, downloads 15 min per PLAN §10). */
export async function createSignedDownloadUrl(bucket: Bucket, path: string, expiresInSeconds: number, downloadName?: string) {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, expiresInSeconds, downloadName ? { download: downloadName } : undefined);
  if (error) throw new Error(`Storage download URL failed: ${error.message}`);
  return data.signedUrl;
}
