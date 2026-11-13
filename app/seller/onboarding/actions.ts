'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ZodError, z } from 'zod';
import type { Session } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import {
  KYC_DOC_KINDS,
  OnboardingError,
  PayoutAccountError,
  SELLER_TERMS,
  acceptSellerTerms,
  confirmSellerDocument,
  createSellerAccount,
  requestSellerDocumentUpload,
  setPayoutAccount,
  setSellerPan,
  updateSellerProfile,
} from '@/lib/sellers/server';
import { requireSellerSession } from '../session';

const HERE = '/seller/onboarding';
type Ctx = { ip: string | null; userAgent: string | null };

const MESSAGES: Record<string, string> = {
  unverified: 'Confirm your email or phone first.',
  mfa_required: 'Sign in with your authenticator app first (two-factor), then try again.',
  forbidden: 'Only the account owner can do this.',
  not_found: 'That was not found.',
};

/** User-facing text for the errors the slices raise on purpose; anything else is a bug and propagates. */
function friendly(e: unknown): string | null {
  if (e instanceof ZodError) return e.issues[0]?.message ?? 'Check the form and try again.';
  if (e instanceof OnboardingError || e instanceof PayoutAccountError) return MESSAGES[e.message] ?? e.message;
  return null;
}

/** Runs one form action as the signed-in seller and comes back to the checklist with a message. */
async function submit(fn: (session: Session, orgId: string | null, ctx: Ctx) => Promise<void>, done: string): Promise<never> {
  const { session, orgId } = await requireSellerSession(HERE);
  const h = await headers();
  let error: string | null = null;
  try {
    await fn(session, orgId, { ip: clientIp(h), userAgent: h.get('user-agent') });
  } catch (e) {
    error = friendly(e);
    if (error === null) throw e;
  }
  revalidatePath(HERE);
  redirect(`${HERE}?${error ? `error=${encodeURIComponent(error)}` : `done=${encodeURIComponent(done)}`}`);
}

const text = (f: FormData, k: string) => (typeof f.get(k) === 'string' ? (f.get(k) as string) : '');
function requireOrg(orgId: string | null): string {
  if (!orgId) throw new OnboardingError('Create your seller account first.');
  return orgId;
}
/** The profile fields both forms share; the slice's zod schema does the real validation. */
const profileFields = (f: FormData) => ({
  entityType: text(f, 'entityType'),
  gstin: text(f, 'gstin'),
  opsContactEmail: text(f, 'opsContactEmail'),
  opsContactPhone: text(f, 'opsContactPhone') || undefined,
});

export async function createSellerAction(formData: FormData) {
  return submit(async (session) => {
    await createSellerAccount(getDb(), session, {
      ...profileFields(formData),
      legalName: text(formData, 'legalName'),
      displayName: text(formData, 'displayName'),
      worldwideRightsWarranted: formData.get('worldwideRightsWarranted') === 'on', // the schema rejects false with a message
    });
  }, 'Seller account created.');
}

export async function updateProfileAction(formData: FormData) {
  return submit(async (session, orgId) => {
    await updateSellerProfile(getDb(), session, requireOrg(orgId), profileFields(formData));
  }, 'Profile saved.');
}

export async function setPanAction(formData: FormData) {
  return submit(async (session, orgId, ctx) => {
    await setSellerPan(getDb(), session, requireOrg(orgId), text(formData, 'pan'), { ip: ctx.ip });
  }, 'PAN saved.');
}

export async function setBankAction(formData: FormData) {
  return submit(async (session, orgId, ctx) => {
    await setPayoutAccount(getDb(), session, requireOrg(orgId), { accountNumber: text(formData, 'accountNumber'), ifsc: text(formData, 'ifsc'), accountHolderName: text(formData, 'accountHolderName') }, ctx.ip);
  }, 'Bank account saved. Finance will verify it before the first payout.');
}

const termsInput = z.array(z.enum(SELLER_TERMS)).min(1, 'Tick the box to accept.');
export async function acceptTermsAction(formData: FormData) {
  return submit(async (session, orgId, ctx) => {
    const kinds = termsInput.parse(formData.getAll('kind'));
    await acceptSellerTerms(getDb(), session, requireOrg(orgId), kinds, ctx);
  }, 'Accepted.');
}

/** Step 1 of a KYC upload: a document row and a short-lived signed upload URL for the browser. */
export async function requestKycUploadAction(raw: { kind: string; mime: string }) {
  const { session, orgId } = await requireSellerSession(HERE);
  const input = z.object({ kind: z.enum(KYC_DOC_KINDS), mime: z.string().max(100) }).parse(raw);
  try {
    return { ok: true as const, ...(await requestSellerDocumentUpload(getDb(), session, requireOrg(orgId), input)) };
  } catch (e) {
    const message = friendly(e);
    if (message === null) throw e;
    return { ok: false as const, error: message };
  }
}

/** Step 3: the server downloads the upload and checks its content (magic bytes, size, PDF active content). */
export async function confirmKycDocumentAction(documentId: string) {
  const { session } = await requireSellerSession(HERE);
  try {
    return { ok: true as const, ...(await confirmSellerDocument(getDb(), session, z.uuid().parse(documentId))) };
  } catch (e) {
    const message = friendly(e);
    if (message === null) throw e;
    return { ok: false as const, error: message };
  }
}
