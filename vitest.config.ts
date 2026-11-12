import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Integration tests run against the local Supabase Postgres (`npm run supabase:start`, port 54322).
export default defineConfig({
  resolve: {
    alias: {
      '@': r('./'),
      'server-only': r('./tests/server-only-stub.ts'),
    },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**', '.next/**'],
    globalSetup: ['./tests/global-setup.ts'],
    setupFiles: ['./tests/setup.ts'],
    fileParallelism: false, // tests share one database
  },
});
