import { NextResponse } from 'next/server';
import { endSession } from '@/lib/identity/server';

export const dynamic = 'force-dynamic';

/**
 * A plain form POST, then a full page load: nothing re-renders in between, and the client router's cached signed-in pages
 * go with it. Cross-site posts cannot sign anyone out: the session cookie is SameSite=Lax, so it is not sent with them.
 */
export async function POST(req: Request) {
  await endSession();
  return NextResponse.redirect(new URL('/', req.url), 303);
}
