import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/migrations',
  // Direct (non-pooled) connection; the app itself uses DATABASE_URL (transaction pooler).
  dbCredentials: { url: process.env.DIRECT_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' },
});
