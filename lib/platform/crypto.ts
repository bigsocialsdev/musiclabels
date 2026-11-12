import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';

const VERSION = 'v1';

function keyring(): Map<string, Buffer> {
  return new Map(
    getEnv()
      .ENCRYPTION_KEYS.split(',')
      .map((p) => {
        const [id, key] = p.split(':') as [string, string];
        return [id, Buffer.from(key, 'base64')];
      }),
  );
}

/** AES-256-GCM. Output `v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64url parts); key id enables rotation. */
export function encrypt(plaintext: string): string {
  const keyId = getEnv().ENCRYPTION_ACTIVE_KEY_ID;
  const key = keyring().get(keyId)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, keyId, iv, cipher.getAuthTag(), ct]
    .map((p, i) => (i < 2 ? p : (p as Buffer).toString('base64url')))
    .join(':');
}

export function decrypt(payload: string): string {
  const [version, keyId, iv, tag, ct] = payload.split(':');
  if (version !== VERSION || !keyId || !iv || !tag || !ct) throw new Error('Malformed ciphertext');
  const key = keyring().get(keyId);
  if (!key) throw new Error('Unknown encryption key id');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/** Show only the last `visible` characters, e.g. bank account `XXXXXX1234`. */
export function maskTail(value: string, visible = 4): string {
  return value.length <= visible ? 'X'.repeat(value.length) : 'X'.repeat(value.length - visible) + value.slice(-visible);
}

/** Constant-time string comparison (secrets, HMACs). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
