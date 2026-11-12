import { createHash, randomBytes } from 'node:crypto';
import { CROCKFORD_ALPHABET, formatPublicId } from '../index';

/**
 * RFC 8785 (JCS) canonical JSON. Object keys sort by UTF-16 code units (JS's default sort), strings and
 * numbers serialise as ECMAScript JSON.stringify does, no whitespace. Rejects what JCS/I-JSON cannot carry
 * (non-finite numbers, lone surrogates) and anything that is not plain JSON data (undefined, Date, class instances).
 */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') {
    if (!v.isWellFormed()) throw new TypeError('canonicalize: string contains a lone surrogate');
    return JSON.stringify(v);
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('canonicalize: non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalize: not a plain object');
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys.map((k) => `${canonicalize(k)}:${canonicalize(o[k])}`).join(',')}}`;
  }
  throw new TypeError(`canonicalize: unsupported value of type ${typeof v}`);
}

export const HASH_SCHEMA = 'mrm-license-v1';

/** The immutable grant (PLAN §7). Fixed field list: changing it means a new schema tag, never editing v1. */
export type RecordHashInputV1 = {
  public_id: string;
  track_version_id: string;
  master_sha256: string;
  track_title: string;
  primary_artist: string;
  tier: string;
  terms_version_id: string;
  license_text_sha256: string;
  licensee_name: string;
  client_name: string | null;
  purchaser_org_id: string;
  territory: string;
  edits_allowed: boolean;
  starts_at: string; // ISO 8601 UTC with milliseconds (Date#toISOString)
  ends_at: string | null;
  invoice_number: string;
};

/** The stored license columns that feed the hash. */
export type HashedLicenseFields = {
  publicId: string;
  trackVersionId: string;
  masterSha256: string;
  trackTitle: string;
  primaryArtist: string;
  tier: string;
  termsVersionId: string;
  licenseTextSha256: string;
  licenseeName: string;
  clientName: string | null;
  purchaserOrgId: string;
  territory: string;
  editsAllowed: boolean;
  startsAt: Date;
  endsAt: Date | null;
  invoiceNumber: string;
};

export function recordHashInput(l: HashedLicenseFields): RecordHashInputV1 {
  return {
    public_id: l.publicId,
    track_version_id: l.trackVersionId,
    master_sha256: l.masterSha256,
    track_title: l.trackTitle,
    primary_artist: l.primaryArtist,
    tier: l.tier,
    terms_version_id: l.termsVersionId,
    license_text_sha256: l.licenseTextSha256,
    licensee_name: l.licenseeName,
    client_name: l.clientName,
    purchaser_org_id: l.purchaserOrgId,
    territory: l.territory,
    edits_allowed: l.editsAllowed,
    starts_at: l.startsAt.toISOString(),
    ends_at: l.endsAt ? l.endsAt.toISOString() : null,
    invoice_number: l.invoiceNumber,
  };
}

/** Lowercase hex SHA-256 of UTF-8 `"mrm-license-v1\n" + JCS(input)`. */
export function computeRecordHash(input: RecordHashInputV1): string {
  return createHash('sha256').update(`${HASH_SCHEMA}\n${canonicalize(input)}`, 'utf8').digest('hex');
}

/** Recomputes from stored fields. False means the row no longer matches what was issued. */
export function isRecordIntact(l: HashedLicenseFields & { hashSchema: string; recordHash: string }): boolean {
  return l.hashSchema === HASH_SCHEMA && computeRecordHash(recordHashInput(l)) === l.recordHash;
}

/** 128 CSPRNG bits as 26 Crockford base32 characters (two leading zero bits). Never sequential or derived. */
export function newPublicId(): string {
  let n = 0n;
  for (const b of randomBytes(16)) n = (n << 8n) | BigInt(b);
  let s = '';
  for (let i = 0; i < 26; i++) {
    s = CROCKFORD_ALPHABET[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return formatPublicId(s);
}
