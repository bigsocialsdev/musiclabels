import 'server-only';
import { AwsClient } from 'aws4fetch';
import { getEnv, type Env } from './env';
import type { OffsiteStore } from './storage-backup';

/** Cloudflare R2 (S3-compatible) as the off-site store (PLAN F11, owner decision 2026-11-12). Credentials are server-only env vars. */
export function r2OffsiteStore(env: Pick<Env, 'BACKUP_S3_ENDPOINT' | 'BACKUP_S3_BUCKET' | 'BACKUP_S3_ACCESS_KEY_ID' | 'BACKUP_S3_SECRET_ACCESS_KEY'> = getEnv()): OffsiteStore {
  const { BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_BUCKET: bucket, BACKUP_S3_ACCESS_KEY_ID: accessKeyId, BACKUP_S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('Off-site backup is not configured: set BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY');
  }
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const urlFor = (key: string) => `${endpoint.replace(/\/$/, '')}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return {
    async put(key, body, contentType) {
      const res = await client.fetch(urlFor(key), { method: 'PUT', body: body as unknown as BodyInit, headers: { 'content-type': contentType ?? 'application/octet-stream' } });
      if (!res.ok) throw new Error(`Off-site upload failed (${res.status})`);
      // For a single-part upload the ETag is the MD5 of the stored bytes.
      return { md5: (res.headers.get('etag') ?? '').replaceAll('"', '').toLowerCase() };
    },
    async get(key) {
      const res = await client.fetch(urlFor(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Off-site download failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
