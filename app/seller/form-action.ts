import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { CatalogError } from '@/lib/catalog/server';
import type { Session } from '@/lib/identity/server';
import { clientIp } from '@/lib/platform/request';
import { OnboardingError, PayoutAccountError } from '@/lib/sellers/server';
import { requireSellerSession } from './session';

const MESSAGES: Record<string, string> = {
  unverified: 'Confirm your email or phone first.',
  mfa_required: 'Sign in with your authenticator app first (two-factor), then try again.',
  forbidden: 'Only the account owner can do this.',
  not_found: 'That was not found.',
};

/** User-facing text for the errors the slices raise on purpose; anything else is a bug and propagates. */
export function friendly(e: unknown): string | null {
  if (e instanceof ZodError) return e.issues[0]?.message ?? 'Check the form and try again.';
  if (e instanceof OnboardingError || e instanceof PayoutAccountError || e instanceof CatalogError) return MESSAGES[e.message] ?? e.message;
  return null;
}

export type SellerCtx = { session: Session; orgId: string | null; ip: string | null; userAgent: string | null };

/** A form field as a string ('' when missing or a file). */
export const text = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? (f.get(k) as string) : '');

export function requireOrg(orgId: string | null): string {
  if (!orgId) throw new OnboardingError('Create your seller account first.');
  return orgId;
}

/**
 * Runs one form action as the signed-in seller and comes back to `here` with a message. `fn` may return a path to
 * land on instead (a new track's page). Redirect messages are server-written text, never user input.
 */
export async function runForm(here: string, done: string, fn: (ctx: SellerCtx) => Promise<string | void>): Promise<never> {
  const { session, orgId } = await requireSellerSession(here);
  const h = await headers();
  let error: string | null = null;
  let to = here;
  try {
    to = (await fn({ session, orgId, ip: clientIp(h), userAgent: h.get('user-agent') })) ?? here;
  } catch (e) {
    error = friendly(e);
    if (error === null) throw e;
  }
  revalidatePath(here);
  redirect(`${to}?${error ? `error=${encodeURIComponent(error)}` : `done=${encodeURIComponent(done)}`}`);
}

/** The same for calls from client components (uploads): the slices' deliberate errors come back as `{ ok: false }`. */
export async function attempt<T extends object>(fn: () => Promise<T>): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    const error = friendly(e);
    if (error === null) throw e;
    return { ok: false, error };
  }
}
