import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { OnboardingError, sellerDocumentDownloadUrl } from '@/lib/sellers/server';
import { requireAdminArea } from '../../../../guard';

export const dynamic = 'force-dynamic';

/** Admin-only: redirects to a 15-minute signed URL that forces an attachment download (PLAN F9). Audited as `seller_document.download`. */
export async function GET(req: Request, { params }: { params: Promise<{ orgId: string; docId: string }> }) {
  const { docId } = await params;
  const admin = await requireAdminArea('verification', '/admin/kyc');
  if (!z.uuid().safeParse(docId).success) notFound();
  let url: string;
  try {
    url = await sellerDocumentDownloadUrl(getDb(), admin, docId, clientIp(req.headers));
  } catch (e) {
    if (e instanceof OnboardingError) notFound();
    throw e;
  }
  redirect(url);
}
