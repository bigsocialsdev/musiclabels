import type { MetadataRoute } from 'next';
import { listSellableSlugs } from '@/lib/catalog/server';
import { getEnv } from '@/lib/platform/env';
import { getDb } from '@/lib/platform/db';

export const dynamic = 'force-dynamic';

/** The home page and every track that can be bought today. Filtered and paged views are not listed (they are noindex). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getEnv().APP_URL;
  const slugs = await listSellableSlugs(getDb());
  return [{ url: base, changeFrequency: 'daily' }, ...slugs.map((s) => ({ url: `${base}/track/${s.slug}`, lastModified: s.publishedAt ?? undefined }))];
}
