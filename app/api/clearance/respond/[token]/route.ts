import { RESPONSE_TOKEN_PATTERN, peekResponse, respondToClearance } from '@/lib/clearance/server';
import { getDb } from '@/lib/platform/db';
import { consume } from '@/lib/platform/ratelimit';
import { clientIp } from '@/lib/platform/request';

export const dynamic = 'force-dynamic';

// Seller response link (PLAN §2.4, §4.5). The token is the credential, so: GET only shows the form and never
// consumes it (mail scanners open links), POST uses it once, nothing is cached, and the token never leaves the URL.
const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
};
const LIMIT = { capacity: 20, refillPerSecond: 0.1 };

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const page = (status: number, title: string, body: string) =>
  new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px system-ui;max-width:36rem;margin:3rem auto;padding:0 1rem}textarea{width:100%}button{padding:.5rem 1rem}</style><h1>${esc(title)}</h1>${body}`, { status, headers: HEADERS });
const invalid = () => page(404, 'Link not valid', '<p>This link is invalid, has expired or was already used. Ask the platform team to send a new one.</p>');

async function guard(req: Request, token: string): Promise<Response | null> {
  if (!(await consume(`clearance-respond:${clientIp(req.headers) ?? 'unknown'}`, LIMIT))) return page(429, 'Too many requests', '<p>Please try again in a minute.</p>');
  if (!RESPONSE_TOKEN_PATTERN.test(token)) return invalid();
  return null;
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const denied = await guard(req, token);
  if (denied) return denied;
  const v = await peekResponse(getDb(), token);
  if (!v) return invalid();
  return page(
    200,
    'Clearance request',
    `<p>${esc(v.licenseeName)} licensed “${esc(v.trackTitle)}” and will use it on ${esc(v.what)}.</p>
<p>Please release or allowlist this use with the platform, then tell us the result. This is a process we track; it does not promise protection.</p>
<form method="post">
<p><label><input type="radio" name="outcome" value="released" required> The use is released or allowlisted</label></p>
<p><label><input type="radio" name="outcome" value="declined"> I cannot release this use</label></p>
<p><label>Note (optional)<br><textarea name="note" rows="4" maxlength="2000"></textarea></label></p>
<button>Send answer</button></form>`,
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const denied = await guard(req, token);
  if (denied) return denied;
  const form = await req.formData().catch(() => null);
  const result = await respondToClearance(getDb(), token, { outcome: form?.get('outcome'), note: form?.get('note')?.toString() ?? undefined });
  if (!result.ok) return result.reason === 'bad_input' ? page(400, 'Choose an answer', '<p>Go back and choose an answer.</p>') : invalid();
  return page(200, 'Thank you', `<p>We recorded your answer (${result.outcome === 'released' ? 'released' : 'cannot release'}). You can close this page.</p>`);
}
