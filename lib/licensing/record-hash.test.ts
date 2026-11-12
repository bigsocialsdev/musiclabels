import { describe, expect, it } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  LICENSE_EVENTS,
  LICENSE_STATUSES,
  addMonthsUtc,
  canonicalize,
  computeRecordHash,
  effectiveStatus,
  nextLicenseStatus,
  newPublicId,
  normalizePublicId,
  recordHashInput,
  type RecordHashInputV1,
} from './server';

describe('RFC 8785 canonicalization', () => {
  it('matches the RFC 3.2.2 serialisation example', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units (RFC 3.2.3 example)', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    };
    // Compare the string itself: Object.keys would hoist the integer-like key "1".
    const order = ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ'] as const;
    expect(canonicalize(input)).toBe(`{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify(input[k])}`).join(',')}}`);
  });

  it('rejects values JCS cannot represent', () => {
    expect(() => canonicalize({ a: undefined })).toThrow();
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(Infinity)).toThrow();
    expect(() => canonicalize(new Date())).toThrow();
    expect(() => canonicalize('\ud800')).toThrow(/surrogate/);
  });
});

describe('record hash (mrm-license-v1)', () => {
  // Golden vector. The expected canonical string was written by hand and its hash computed with sha256sum,
  // independently of this code. If this test fails, issued certificates would stop verifying: never update
  // the expected values; introduce mrm-license-v2 instead.
  const golden: RecordHashInputV1 = {
    public_id: 'LIC-0ABCD-EFGHJ-KMNPQ-RSTVW-XYZ012',
    track_version_id: '01890a5d-ac96-774b-bcce-b302099a8057',
    master_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    track_title: 'Monsoon "Drive"',
    primary_artist: 'राग Collective',
    tier: 'paid_ad',
    terms_version_id: '01890a5d-ac96-774b-bcce-b302099a8058',
    license_text_sha256: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
    licensee_name: 'Ünïcode Brand Pvt Ltd',
    client_name: null,
    purchaser_org_id: '01890a5d-ac96-774b-bcce-b302099a8059',
    territory: 'worldwide',
    edits_allowed: true,
    starts_at: '2026-11-12T10:30:00.000Z',
    ends_at: '2027-11-12T10:30:00.000Z',
    invoice_number: 'MRM/26-27/000001',
  };

  it('canonical form and hash match the golden vector', () => {
    expect(canonicalize(golden)).toBe(
      '{"client_name":null,"edits_allowed":true,"ends_at":"2027-11-12T10:30:00.000Z","invoice_number":"MRM/26-27/000001",' +
        '"license_text_sha256":"2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae","licensee_name":"Ünïcode Brand Pvt Ltd",' +
        '"master_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","primary_artist":"राग Collective",' +
        '"public_id":"LIC-0ABCD-EFGHJ-KMNPQ-RSTVW-XYZ012","purchaser_org_id":"01890a5d-ac96-774b-bcce-b302099a8059",' +
        '"starts_at":"2026-11-12T10:30:00.000Z","terms_version_id":"01890a5d-ac96-774b-bcce-b302099a8058","territory":"worldwide",' +
        '"tier":"paid_ad","track_title":"Monsoon \\"Drive\\"","track_version_id":"01890a5d-ac96-774b-bcce-b302099a8057"}',
    );
    expect(computeRecordHash(golden)).toBe('6d5315dc3d689eb45bd3e2f1349bd6bb0d7157eaca82b25364621f3c86ecbb5c');
  });

  it('is built from the stored columns with the fixed v1 field list', () => {
    const input = recordHashInput({
      publicId: golden.public_id,
      trackVersionId: golden.track_version_id,
      masterSha256: golden.master_sha256,
      trackTitle: golden.track_title,
      primaryArtist: golden.primary_artist,
      tier: golden.tier,
      termsVersionId: golden.terms_version_id,
      licenseTextSha256: golden.license_text_sha256,
      licenseeName: golden.licensee_name,
      clientName: null,
      purchaserOrgId: golden.purchaser_org_id,
      territory: 'worldwide',
      editsAllowed: true,
      startsAt: new Date(golden.starts_at),
      endsAt: new Date(golden.ends_at!),
      invoiceNumber: golden.invoice_number,
    });
    expect(input).toEqual(golden);
    expect(Object.keys(input)).toHaveLength(16);
  });

  it('changes when any hashed field changes', () => {
    const base = computeRecordHash(golden);
    expect(computeRecordHash({ ...golden, licensee_name: 'Someone Else' })).not.toBe(base);
    expect(computeRecordHash({ ...golden, client_name: '' })).not.toBe(base);
    expect(computeRecordHash({ ...golden, ends_at: null })).not.toBe(base);
    expect(computeRecordHash({ ...golden, edits_allowed: false })).not.toBe(base);
  });
});

describe('public_id', () => {
  it('is LIC- plus 26 Crockford base32 characters in the documented grouping', () => {
    for (let i = 0; i < 200; i++) {
      const id = newPublicId();
      expect(id).toMatch(/^LIC-[0-7][0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(normalizePublicId(id)).toBe(id);
    }
  });

  it('is random, not sequential: no collisions and every character position varies', () => {
    const ids = Array.from({ length: 2000 }, newPublicId);
    expect(new Set(ids).size).toBe(ids.length);
    const raw = ids.map((id) => id.replace(/^LIC-|-/g, ''));
    for (let pos = 1; pos < 26; pos++) expect(new Set(raw.map((r) => r[pos])).size).toBeGreaterThan(20);
    expect(new Set(raw.map((r) => r[0])).size).toBe(4 * 2); // top char carries 3 bits: 0–7
  });

  it('normalises what people type and rejects the rest', () => {
    expect(normalizePublicId(' lic-0abcd efghj-kmnpq-rstvw-xyz012 ')).toBe('LIC-0ABCD-EFGHJ-KMNPQ-RSTVW-XYZ012');
    expect(normalizePublicId('0ABCDEFGHJKMNPQRSTVWXYZ012')).toBe('LIC-0ABCD-EFGHJ-KMNPQ-RSTVW-XYZ012');
    expect(normalizePublicId('LIC-OABCD-EFGHJ-KMNPQ-RSTVW-XYZOI2')).toBe('LIC-0ABCD-EFGHJ-KMNPQ-RSTVW-XYZ012');
    expect(normalizePublicId('LIC-8ABCD-EFGHJ-KMNPQ-RSTVW-XYZ012')).toBeNull(); // > 128 bits
    expect(normalizePublicId('LIC-0ABCD-EFGHJ-KMNPQ-RSTVW-XYZ01U')).toBeNull(); // U is not Crockford
    expect(normalizePublicId('LIC-0ABCD')).toBeNull();
    expect(normalizePublicId("'; drop table licenses; --")).toBeNull();
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
  });
});

describe('term arithmetic and status', () => {
  it('adds calendar months in UTC, clamping to month end', () => {
    expect(addMonthsUtc(new Date('2026-11-12T10:30:00.000Z'), 12).toISOString()).toBe('2027-11-12T10:30:00.000Z');
    expect(addMonthsUtc(new Date('2027-02-28T00:00:00.000Z'), 12).toISOString()).toBe('2028-02-28T00:00:00.000Z');
    expect(addMonthsUtc(new Date('2028-02-29T05:00:00.000Z'), 12).toISOString()).toBe('2029-02-28T05:00:00.000Z');
    expect(addMonthsUtc(new Date('2026-01-31T23:59:59.999Z'), 1).toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('a fixed-term license past ends_at is effectively expired; perpetual never is', () => {
    const now = new Date('2027-11-12T10:30:00.000Z');
    expect(effectiveStatus({ status: 'active', endsAt: new Date('2027-11-12T10:30:00.000Z') }, now)).toBe('expired');
    expect(effectiveStatus({ status: 'active', endsAt: new Date('2027-11-12T10:30:00.001Z') }, now)).toBe('active');
    expect(effectiveStatus({ status: 'active', endsAt: null }, now)).toBe('active');
    expect(effectiveStatus({ status: 'revoked', endsAt: new Date(0) }, now)).toBe('revoked');
  });

  it('transition table: only active → expired | revoked', () => {
    const allowed = new Set(['active/expire/expired', 'active/revoke/revoked']);
    for (const from of LICENSE_STATUSES) {
      for (const event of LICENSE_EVENTS) {
        const to = nextLicenseStatus(from, event);
        expect(to === null ? null : `${from}/${event}/${to}`).toBe(allowed.has(`${from}/${event}/${to}`) ? `${from}/${event}/${to}` : null);
      }
    }
  });
});
