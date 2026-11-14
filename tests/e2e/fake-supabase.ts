import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { BrowserContext } from '@playwright/test';

/**
 * Stand-in for the parts of Supabase the app calls, for local and CI e2e runs without those containers. Tests only: the
 * server is pointed at it with NEXT_PUBLIC_SUPABASE_URL.
 *  - Auth: the app asks who a token belongs to (`GET /auth/v1/user`); this answers from the token itself. Supabase makes
 *    that same call for any token that has no asymmetric signing key.
 *  - Storage: objects are kept in memory (upload, signed URL, download), enough for fulfilment to store the invoice and
 *    certificate PDFs and for the buyer to download them.
 */
const TOKEN_SIGNING_SECRET = 'e2e-fake-auth';
const b64 = (v: object | string) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';

export function startFakeSupabase(): Promise<Server> {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };

    const object = url.pathname.match(/^\/storage\/v1\/object\/(sign\/)?([^/]+)\/(.+)$/);
    if (object) {
      const key = `${object[2]}/${decodeURIComponent(object[3]!)}`;
      if (req.method === 'GET') {
        const found = objects.get(key);
        if (!found) return json(404, { error: 'not_found', message: 'Object not found' });
        res.setHeader('content-type', found.type);
        return void res.end(found.body);
      }
      if (object[1]) return objects.has(key) ? json(200, { signedURL: `/object/sign/${object[2]}/${object[3]}?token=e2e` }) : json(400, { error: 'not_found', message: 'Object not found' });
      objects.set(key, { body: Buffer.concat(chunks), type: String(req.headers['content-type'] ?? 'application/octet-stream') });
      return json(200, { Id: key, Key: key });
    }

    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const payload = token.split('.')[1];
    let claims: { sub?: string; email?: string } | null = null;
    try {
      claims = payload ? JSON.parse(Buffer.from(payload, 'base64url').toString()) : null;
    } catch {} // not a token this server made: answer 401
    if (url.pathname.startsWith('/auth/v1/user') && claims) {
      const at = new Date(0).toISOString();
      json(200, { id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email, email_confirmed_at: at, app_metadata: {}, user_metadata: {}, created_at: at });
    } else {
      json(401, {});
    }
  });
  return new Promise((resolve) => server.listen(Number(new URL(supabaseUrl()).port), '127.0.0.1', () => resolve(server)));
}

/** Signs the browser context in as `userId`, in the cookie format @supabase/ssr reads. */
export async function signIn(context: BrowserContext, who: { userId: string; email: string; aal?: 'aal1' | 'aal2' }) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: who.userId, email: who.email, aud: 'authenticated', role: 'authenticated', aal: who.aal ?? 'aal1', iat: now, exp: now + 3600 };
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  const jwt = `${head}.${body}.${createHmac('sha256', TOKEN_SIGNING_SECRET).update(`${head}.${body}`).digest('base64url')}`;
  const session = { access_token: jwt, refresh_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: claims.exp, user: { id: who.userId, email: who.email } };
  const name = `sb-${new URL(supabaseUrl()).hostname.split('.')[0]}-auth-token`;
  await context.clearCookies();
  await context.addCookies([{ name, value: `base64-${b64(JSON.stringify(session))}`, url: process.env.E2E_BASE_URL ?? 'http://localhost:3000' }]);
}
