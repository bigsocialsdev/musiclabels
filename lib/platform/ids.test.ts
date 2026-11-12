import { describe, expect, it } from 'vitest';
import { uuidv7 } from './ids';

describe('uuidv7', () => {
  it('has version 7, RFC variant and the timestamp prefix', () => {
    const id = uuidv7(0x0123456789ab);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.replace(/-/g, '').slice(0, 12)).toBe('0123456789ab');
  });

  it('sorts by creation time', () => {
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });
});
