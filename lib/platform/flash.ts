import 'server-only';
import { decrypt, encrypt } from './crypto';

export type FlashKind = 'error' | 'done';
const PREFIX = 'flash:'; // keeps a flash token from being read as any other encrypted value

/**
 * A one-line message to show on the next page, carried in the redirect URL. It is sealed (AES-GCM) so a page can
 * only show text the server itself wrote: a hand-made link cannot put its own words in the banner.
 */
export function sealFlash(kind: FlashKind, text: string): string {
  return encrypt(`${PREFIX}${kind}:${text}`);
}

/** The message in a token, or null when it is missing, forged or not a flash. */
export function openFlash(token: string | undefined): { kind: FlashKind; text: string } | null {
  if (!token) return null;
  try {
    const plain = decrypt(token);
    if (!plain.startsWith(PREFIX)) return null;
    const rest = plain.slice(PREFIX.length);
    const kind = rest.startsWith('error:') ? 'error' : rest.startsWith('done:') ? 'done' : null;
    return kind ? { kind, text: rest.slice(kind.length + 1) } : null;
  } catch {
    return null;
  }
}
