import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // ffmpeg-static is a native binary: keep it out of the bundle and make sure it ships with every route that runs ingest.
  serverExternalPackages: ['ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/tasks/ingest': ['./node_modules/ffmpeg-static/**/*'],
    '/api/cron/tasks-sweep': ['./node_modules/ffmpeg-static/**/*'],
    // Add the seller upload pages when S4-M7 kicks ingest from a server action.
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
