'use server';
import { headers } from 'next/headers';
import { submitEnquiry } from '@/lib/enquiries/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';

export type EnquiryState = { status: 'idle' } | { status: 'sent'; email: string } | { status: 'error'; message: string; fields: string[] };

const text = (f: FormData, k: string) => String(f.get(k) ?? '');

/** Public enquiry for a Commercial/Broadcast license. The slice validates, rate limits and writes the lead and its emails. */
export async function enquiryAction(trackId: string, _prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  const res = await submitEnquiry(
    getDb(),
    {
      trackId,
      contactName: text(form, 'contactName'),
      contactEmail: text(form, 'contactEmail'),
      contactPhone: text(form, 'contactPhone') || undefined,
      media: text(form, 'media') as 'tv',
      intendedUse: text(form, 'intendedUse'),
      budgetRange: text(form, 'budgetRange') || undefined,
    },
    { ip: clientIp(await headers()) },
  );
  if (res.ok) return { status: 'sent', email: text(form, 'contactEmail') };
  if (res.issues.includes('rate_limited')) return { status: 'error', message: 'Too many enquiries just now. Try again in a little while.', fields: [] };
  return { status: 'error', message: 'Check the highlighted fields and try again.', fields: res.issues };
}
