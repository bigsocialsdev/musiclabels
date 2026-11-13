import { describe, expect, it } from 'vitest';
import { encrypt } from './crypto';
import { openFlash, sealFlash } from './flash';

describe('flash messages', () => {
  it('round-trips a message and keeps its kind', () => {
    expect(openFlash(sealFlash('error', 'Not ready yet: add audio; accept the agreement'))).toEqual({ kind: 'error', text: 'Not ready yet: add audio; accept the agreement' });
    expect(openFlash(sealFlash('done', 'Saved.'))).toEqual({ kind: 'done', text: 'Saved.' });
  });

  it('ignores anything the server did not seal', () => {
    expect(openFlash(undefined)).toBeNull();
    expect(openFlash('')).toBeNull();
    expect(openFlash('Your account is locked, call 555-0100')).toBeNull(); // hand-made text
    const token = sealFlash('done', 'Saved.');
    expect(openFlash(`${token.slice(0, -2)}xx`)).toBeNull(); // tampered
    expect(openFlash(encrypt('ABCDE1234F'))).toBeNull(); // another encrypted value is not a flash
  });
});
