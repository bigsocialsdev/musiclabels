import { expect, it } from 'vitest';
import { safeNext } from './index';

it('allows only same-origin paths', () => {
  expect(safeNext('/legal/accept?x=1')).toBe('/legal/accept?x=1');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', null, undefined, '/a\nb', '/\t/evil.com', '/\u0000x', '/a\\b']) {
    expect(safeNext(bad as string | null)).toBe('/');
  }
  expect(safeNext('//x', '/home')).toBe('/home');
});
