import { describe, expect, it } from 'vitest';
import { istDateTime, own } from './format';

describe('store formatting helpers', () => {
  it('writes the first minutes after IST midnight as 00:xx, never 24:xx', () => {
    expect(istDateTime(new Date('2026-11-12T18:35:00Z'))).toContain('00:05');
  });

  it('finds messages by their own keys only, so a crafted query string finds nothing', () => {
    const map = { ok: 'fine' };
    expect(own(map, 'ok')).toBe('fine');
    expect(own(map, 'constructor')).toBeUndefined();
    expect(own(map, '__proto__')).toBeUndefined();
    expect(own(map, undefined)).toBeUndefined();
  });
});
