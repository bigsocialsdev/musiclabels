import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, maskTail, safeEqual } from './crypto';

describe('crypto', () => {
  it('round-trips and tags the key id', () => {
    const ct = encrypt('1234567890');
    expect(ct.startsWith('v1:k1:')).toBe(true);
    expect(ct).not.toContain('1234567890');
    expect(decrypt(ct)).toBe('1234567890');
  });

  it('uses a fresh IV each time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('rejects tampering and unknown key ids', () => {
    const parts = encrypt('secret').split(':');
    parts[4] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join(':'))).toThrow();
    expect(() => decrypt(['v1', 'k9', ...parts.slice(2)].join(':'))).toThrow(/Unknown/);
    expect(() => decrypt('garbage')).toThrow(/Malformed/);
  });

  it('masks all but the tail', () => {
    expect(maskTail('123456789012')).toBe('XXXXXXXX9012');
    expect(maskTail('12')).toBe('XX');
  });

  it('compares in constant time semantics', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
