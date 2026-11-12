import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { CatalogError, rightsDocumentDownloadUrl } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireVerificationAdmin } from '../../../guard';

export const dynamic = 'force-dynamic';

/** Admin-only: redirects to a 15-minute signed URL that forces an attachment download (PLAN F9). Audited. */
export async function GET(req: Request, { params }: { params: Promise<{ trackId: string; docId: string }> }) {
  const { trackId, docId } = await params;
  const admin = await requireVerificationAdmin(`/admin/verification/${trackId}`);
  if (!z.uuid().safeParse(docId).success) notFound();
  let url: string;
  try {
    url = await rightsDocumentDownloadUrl(getDb(), admin, docId, clientIp(req.headers));
  } catch (e) {
    if (e instanceof CatalogError) notFound();
    throw e;
  }
  redirect(url);
}
