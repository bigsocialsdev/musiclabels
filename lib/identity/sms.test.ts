import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleSendSmsHook } from './server';
import { resetEnvCache } from '@/lib/platform/env';
import { sendOtpViaMsg91, toMsg91Mobile, verifyHookSignature } from './internal/sms';

const key = Buffer.alloc(32, 7);
const secret = `v1,whsec_${key.toString('base64')}`;
const sign = (id: string, ts: string, body: string) =>
  `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;

const stub = (k: string, v: string) => {
  vi.stubEnv(k, v);
  resetEnvCache();
};
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('verifyHookSignature', () => {
  const now = 1_800_000_000;
  const body = '{"a":1}';
  const h = (over = {}) => ({ id: 'msg_1', timestamp: String(now), signature: sign('msg_1', String(now), body), ...over });

  it('accepts a valid signature, including among several', () => {
    expect(verifyHookSignature(h(), body, secret, now)).toBe(true);
    expect(verifyHookSignature(h({ signature: `v1,AAAA ${sign('msg_1', String(now), body)}` }), body, secret, now)).toBe(true);
  });

  it('rejects tampered body, wrong secret, missing headers and stale timestamps', () => {
    expect(verifyHookSignature(h(), '{"a":2}', secret, now)).toBe(false);
    expect(verifyHookSignature(h(), body, `v1,whsec_${Buffer.alloc(32, 8).toString('base64')}`, now)).toBe(false);
    expect(verifyHookSignature(h({ signature: null }), body, secret, now)).toBe(false);
    expect(verifyHookSignature(h(), body, secret, now + 600)).toBe(false);
  });
});

describe('MSG91', () => {
  it('only allows Indian mobile numbers', () => {
    expect(toMsg91Mobile('+919876543210')).toBe('919876543210');
    expect(toMsg91Mobile('+14155550100')).toBeNull();
    expect(toMsg91Mobile('+911234567890')).toBeNull();
    expect(toMsg91Mobile('919876543210')).toBeNull();
  });

  it('calls the OTP API with the key in a header, not the URL', async () => {
    stub('MSG91_AUTH_KEY', 'k-secret');
    stub('MSG91_OTP_TEMPLATE_ID', 'tpl1');
    const f = vi.fn(async () => new Response('{"type":"success"}', { status: 200 }));
    await sendOtpViaMsg91('+919876543210', '123456', f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get('mobile')).toBe('919876543210');
    expect(url.toString()).not.toContain('k-secret');
    expect((init.headers as Record<string, string>).authkey).toBe('k-secret');
  });

  it('surfaces provider errors', async () => {
    stub('MSG91_AUTH_KEY', 'k');
    stub('MSG91_OTP_TEMPLATE_ID', 't');
    const f = async () => new Response('{"type":"error"}', { status: 200 });
    await expect(sendOtpViaMsg91('+919876543210', '1', f as unknown as typeof fetch)).rejects.toThrow(/failed/);
  });
});

describe('handleSendSmsHook', () => {
  const body = JSON.stringify({ user: { phone: '919876543210' }, sms: { otp: '654321' } });
  const req = (sig?: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    return new Request('http://x/api/auth/sms-hook', {
      method: 'POST',
      body,
      headers: { 'webhook-id': 'm1', 'webhook-timestamp': ts, 'webhook-signature': sig ?? sign('m1', ts, body) },
    });
  };

  it('is unavailable until a secret is configured', async () => {
    expect(await handleSendSmsHook(req())).toBe(503);
  });

  it('sends only for signed requests', async () => {
    stub('SEND_SMS_HOOK_SECRET', secret);
    const send = vi.fn(async () => {});
    expect(await handleSendSmsHook(req('v1,bogus'), send)).toBe(401);
    expect(send).not.toHaveBeenCalled();
    expect(await handleSendSmsHook(req(), send)).toBe(200);
    expect(send).toHaveBeenCalledWith('+919876543210', '654321');
  });
});
