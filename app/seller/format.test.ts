import { describe, expect, it } from 'vitest';
import { rupees } from './format';

describe('rupees', () => {
  it('formats integer paise without float arithmetic', () => {
    expect(rupees(0)).toBe('0.00');
    expect(rupees(5)).toBe('0.05');
    expect(rupees(123_450)).toBe('1234.50');
    expect(rupees(-70_000)).toBe('-700.00');
    expect(rupees(9_007_199_254_740_990)).toBe('90071992547409.90');
  });
});
