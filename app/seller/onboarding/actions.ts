'use server';
import { z } from 'zod';
import { getDb } from '@/lib/platform/db';
import {
  KYC_DOC_KINDS,
  SELLER_TERMS,
  acceptSellerTerms,
  confirmSellerDocument,
  createSellerAccount,
  requestSellerDocumentUpload,
  setPayoutAccount,
  setSellerPan,
  updateSellerProfile,
} from '@/lib/sellers/server';
import { attempt, requireOrg, runForm, text } from '../form-action';
import { requireSellerSession } from '../session';

const HERE = '/seller/onboarding';

/** The profile fields both forms share; the slice's zod schema does the real validation. */
const profileFields = (f: FormData) => ({
  entityType: text(f, 'entityType'),
  gstin: text(f, 'gstin'),
  opsContactEmail: text(f, 'opsContactEmail'),
  opsContactPhone: text(f, 'opsContactPhone') || undefined,
});

export async function createSellerAction(formData: FormData) {
  return runForm(HERE, 'Seller account created.', async ({ session }) => {
    await createSellerAccount(getDb(), session, {
      ...profileFields(formData),
      legalName: text(formData, 'legalName'),
      displayName: text(formData, 'displayName'),
      worldwideRightsWarranted: formData.get('worldwideRightsWarranted') === 'on', // the schema rejects false with a message
    });
  });
}

export async function updateProfileAction(formData: FormData) {
  return runForm(HERE, 'Profile saved.', async ({ session, orgId }) => {
    await updateSellerProfile(getDb(), session, requireOrg(orgId), profileFields(formData));
  });
}

export async function setPanAction(formData: FormData) {
  return runForm(HERE, 'PAN saved.', async ({ session, orgId, ip }) => {
    await setSellerPan(getDb(), session, requireOrg(orgId), text(formData, 'pan'), { ip });
  });
}

export async function setBankAction(formData: FormData) {
  return runForm(HERE, 'Bank account saved. Finance will verify it before the first payout.', async ({ session, orgId, ip }) => {
    await setPayoutAccount(getDb(), session, requireOrg(orgId), { accountNumber: text(formData, 'accountNumber'), ifsc: text(formData, 'ifsc'), accountHolderName: text(formData, 'accountHolderName') }, ip);
  });
}

const termsInput = z.array(z.enum(SELLER_TERMS)).min(1, 'Tick the box to accept.');
export async function acceptTermsAction(formData: FormData) {
  return runForm(HERE, 'Accepted.', async ({ session, orgId, ip, userAgent }) => {
    await acceptSellerTerms(getDb(), session, requireOrg(orgId), termsInput.parse(formData.getAll('kind')), { ip, userAgent });
  });
}

/** Step 1 of a KYC upload: a document row and a short-lived signed upload URL for the browser. */
export async function requestKycUploadAction(raw: { choice: string; filename: string; mime: string }) {
  const { session, orgId } = await requireSellerSession(HERE);
  const input = z.object({ choice: z.enum(KYC_DOC_KINDS), mime: z.string().max(100) }).parse(raw);
  return attempt(async () => {
    const r = await requestSellerDocumentUpload(getDb(), session, requireOrg(orgId), { kind: input.choice, mime: input.mime });
    return { id: r.documentId, key: r.key, token: r.token };
  });
}

/** Step 3: the server downloads the upload and checks its content (magic bytes, size, PDF active content). */
export async function confirmKycDocumentAction(documentId: string) {
  const { session } = await requireSellerSession(HERE);
  const id = z.uuid().parse(documentId);
  const r = await attempt(() => confirmSellerDocument(getDb(), session, id));
  if (!r.ok) return r;
  return r.status === 'valid' ? { ok: true as const, message: 'Uploaded and checked.' } : { ok: false as const, error: r.error ?? 'The file was rejected.' };
}
