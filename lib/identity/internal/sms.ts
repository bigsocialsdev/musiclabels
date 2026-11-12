import { createHmac } from 'node:crypto';
import { getEnv } from '@/lib/platform/env';
import { safeEqual } from '@/lib/platform/crypto';

const TOLERANCE_SECONDS = 5 * 60;

/** Verifies a Standard Webhooks signature (what Supabase auth hooks send). */
export function verifyHookSignature(
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^v1,whsec_/, '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  return signature.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && !!sig && safeEqual(sig, expected);
  });
}

type Fetch = typeof fetch;

/** India-only product: only +91 mobile numbers may receive an OTP (also blocks SMS-pumping abuse). */
export function toMsg91Mobile(e164: string): string | null {
  return /^\+91[6-9]\d{9}$/.test(e164) ? e164.slice(1) : null;
}

/** Sends the OTP with MSG91's OTP API. Needs a DLT-registered template id (see MSG91 account). */
export async function sendOtpViaMsg91(e164Phone: string, otp: string, fetchImpl: Fetch = fetch): Promise<void> {
  const { MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID } = getEnv();
  if (!MSG91_AUTH_KEY || !MSG91_OTP_TEMPLATE_ID) throw new Error('MSG91 is not configured');
  const mobile = toMsg91Mobile(e164Phone);
  if (!mobile) throw new Error('Phone number not supported');
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.searchParams.set('template_id', MSG91_OTP_TEMPLATE_ID);
  url.searchParams.set('mobile', mobile);
  url.searchParams.set('otp', otp);
  const res = await fetchImpl(url, { method: 'POST', headers: { authkey: MSG91_AUTH_KEY, 'content-type': 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as { type?: string };
  if (!res.ok || body.type === 'error') throw new Error(`MSG91 send failed (${res.status})`);
}

/** Handler body for Supabase's "Send SMS" hook. Returns the HTTP status to answer with. */
export async function handleSendSmsHook(req: Request, send = sendOtpViaMsg91): Promise<number> {
  const secret = getEnv().SEND_SMS_HOOK_SECRET;
  if (!secret) return 503;
  const raw = await req.text();
  const ok = verifyHookSignature(
    {
      id: req.headers.get('webhook-id'),
      timestamp: req.headers.get('webhook-timestamp'),
      signature: req.headers.get('webhook-signature'),
    },
    raw,
    secret,
  );
  if (!ok) return 401;
  let payload: { user?: { phone?: string }; sms?: { otp?: string } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return 400;
  }
  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp || !toMsg91Mobile(phone.startsWith('+') ? phone : `+${phone}`)) return 400;
  await send(phone.startsWith('+') ? phone : `+${phone}`, otp);
  return 200;
}
