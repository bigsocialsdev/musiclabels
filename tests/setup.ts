// Test env: local Supabase defaults plus dummy values for secrets. Real keys are never needed in tests.
const defaults: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  APP_URL: 'http://localhost:3000',
  CRON_SECRET: 'test-cron-secret-0123456789abcdef',
  TASKS_SECRET: 'test-tasks-secret-0123456789abcdef',
  ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString('base64')},k2:${Buffer.alloc(32, 2).toString('base64')}`,
  ENCRYPTION_ACTIVE_KEY_ID: 'k1',
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'Test <test@example.com>',
  OPS_ALERT_EMAIL: 'ops@example.com',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
