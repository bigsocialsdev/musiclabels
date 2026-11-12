import { expect, it } from 'vitest';
import { clientIp } from './request';

const h = (o: Record<string, string>) => new Headers(o);

it('prefers platform-set headers over x-forwarded-for', () => {
  expect(clientIp(h({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.1.1.1');
  expect(clientIp(h({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '9.9.9.9' }))).toBe('2.2.2.2');
  expect(clientIp(h({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4' }))).toBe('3.3.3.3');
  expect(clientIp(h({}))).toBeNull();
});
