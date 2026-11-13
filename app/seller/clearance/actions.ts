'use server';
import { z } from 'zod';
import { ClearanceInboxError, respondAsSeller } from '@/lib/clearance/server';
import { getDb } from '@/lib/platform/db';
import { requireOrg, runForm, text } from '../form-action';

const HERE = '/seller/clearance';

/** The owner answers one clearance request from the inbox: release or decline, with an optional note. */
export async function respondClearanceAction(formData: FormData) {
  return runForm(HERE, 'Thank you. Your answer has been recorded and the buyer has been told.', async ({ session, orgId, ip }) => {
    const requestId = z.uuid().parse(text(formData, 'requestId'));
    const r = await respondAsSeller(getDb(), { userId: session.userId, orgId: requireOrg(orgId) }, requestId, { outcome: text(formData, 'outcome'), note: text(formData, 'note') || undefined }, ip);
    if (!r.ok) throw new ClearanceInboxError(r.reason === 'not_found' ? 'That request was not found.' : 'This request has already been answered.');
  });
}
