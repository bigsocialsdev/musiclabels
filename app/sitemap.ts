import type { MetadataRoute } from 'next';
import { listSellableSlugs } from '@/lib/catalog/server';
import { headers } from 'next/headers';
import { getEnv } from '@/lib/platform/env';
import { getDb } from '@/lib/platform/db';
import { allowByIp, LIMITS } from '@/lib/platform/ratelimit';

export const dynamic = 'force-dynamic';

/** The home page and every track that can be bought today. Filtered and paged views are not listed (they are noindex). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getEnv().APP_URL;
  const db = getDb();
  if (!(await allowByIp('crawl', await headers(), LIMITS.crawl, db))) return [{ url: base }]; // over the limit: the home page only, no query
  const slugs = await listSellableSlugs(db);
  return [{ url: base, changeFrequency: 'daily' }, ...slugs.map((s) => ({ url: `${base}/track/${s.slug}`, lastModified: s.publishedAt ?? undefined }))];
}
