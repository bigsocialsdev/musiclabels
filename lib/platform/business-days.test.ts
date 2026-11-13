import { describe, expect, it } from 'vitest';
import { addBusinessDays, isWeekendIst } from './business-days';

describe('business days (India, Monday to Friday)', () => {
  it('adds weekdays at the same time of day', () => {
    expect(addBusinessDays(new Date('2030-01-02T10:00:00Z'), 1)).toEqual(new Date('2030-01-03T10:00:00Z')); // Wed -> Thu
    expect(addBusinessDays(new Date('2030-01-02T10:00:00Z'), 3)).toEqual(new Date('2030-01-07T10:00:00Z')); // Wed -> Mon
    expect(addBusinessDays(new Date('2030-01-02T10:00:00Z'), 0)).toEqual(new Date('2030-01-02T10:00:00Z'));
  });

  it('skips Saturday and Sunday', () => {
    expect(addBusinessDays(new Date('2030-01-04T10:00:00Z'), 1)).toEqual(new Date('2030-01-07T10:00:00Z')); // Fri -> Mon
    expect(addBusinessDays(new Date('2030-01-05T10:00:00Z'), 1)).toEqual(new Date('2030-01-07T10:00:00Z')); // Sat -> Mon
    expect(addBusinessDays(new Date('2030-01-06T10:00:00Z'), 1)).toEqual(new Date('2030-01-07T10:00:00Z')); // Sun -> Mon
  });

  it('judges the weekend in IST, not UTC', () => {
    expect(isWeekendIst(new Date('2030-01-04T19:00:00Z'))).toBe(true); // Friday 19:00 UTC is Saturday 00:30 IST
    expect(isWeekendIst(new Date('2030-01-06T19:00:00Z'))).toBe(false); // Sunday 19:00 UTC is Monday 00:30 IST
  });
});
