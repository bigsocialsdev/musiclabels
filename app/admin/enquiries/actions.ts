'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ENQUIRY_STATUSES, setEnquiryStatus } from '@/lib/enquiries/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAnyAdminArea } from '../guard';

export async function setEnquiryStatusAction(enquiryId: string, to: string) {
  const admin = await requireAnyAdminArea('/admin/enquiries');
  const status = z.enum(ENQUIRY_STATUSES).parse(to);
  const r = await setEnquiryStatus(getDb(), admin, z.uuid().parse(enquiryId), status, clientIp(await headers()));
  redirect(`/admin/enquiries?${new URLSearchParams(r.ok ? { done: status } : { error: 'moved' })}`);
}
