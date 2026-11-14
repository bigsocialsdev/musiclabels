import { afterEach, describe, expect, it, vi } from 'vitest';
import { RazorpayGateway } from './razorpay';

const cfg = { keyId: 'rzp_test_x', keySecret: 'secret', webhookSecret: 'hook' };

afterEach(() => vi.unstubAllGlobals());

describe('RAZORPAY_API_URL override (tests only)', () => {
  it('sends the calls to the override instead of Razorpay', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 'order_1' }));
    vi.stubGlobal('fetch', fetchMock);
    await new RazorpayGateway({ ...cfg, apiUrl: 'http://127.0.0.1:54399/v1' }).createOrder({ amountPaise: 100, receipt: 'r', notes: {} });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:54399/v1/orders', expect.anything());
  });

  it('defaults to the real API', async () => {
    const fetchMock = vi.fn(async () => Response.json({ id: 'order_1' }));
    vi.stubGlobal('fetch', fetchMock);
    await new RazorpayGateway(cfg).createOrder({ amountPaise: 100, receipt: 'r', notes: {} });
    expect(fetchMock).toHaveBeenCalledWith('https://api.razorpay.com/v1/orders', expect.anything());
  });

  it('refuses an override that is not this machine, whatever the key', () => {
    for (const keyId of ['rzp_test_x', 'rzp_live_x', ' RZP_LIVE_x']) {
      expect(() => new RazorpayGateway({ ...cfg, keyId, apiUrl: 'https://example.com/v1' })).toThrow('this machine');
      expect(() => new RazorpayGateway({ ...cfg, keyId, apiUrl: 'http://127.0.0.1.example.com/v1' })).toThrow('this machine');
    }
    expect(() => new RazorpayGateway({ ...cfg, keyId: 'rzp_live_x' })).not.toThrow();
    expect(() => new RazorpayGateway({ ...cfg, apiUrl: 'http://localhost:54399/v1' })).not.toThrow();
  });
});
