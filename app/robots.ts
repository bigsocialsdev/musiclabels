import type { MetadataRoute } from 'next';
import { getEnv } from '@/lib/platform/env';

// Reads the validated env, so it renders per request rather than at build.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/seller', '/admin', '/auth', '/checkout', '/orders', '/licenses', '/legal'] },
    sitemap: `${getEnv().APP_URL}/sitemap.xml`,
  };
}
