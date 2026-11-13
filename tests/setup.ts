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
  RAZORPAY_KEY_ID: 'rzp_test_dummy',
  RAZORPAY_KEY_SECRET: 'test-razorpay-key-secret',
  RAZORPAY_WEBHOOK_SECRET: 'test-razorpay-webhook-secret',
  SUPPLIER_GSTIN: '27AAPFU0939F1ZV', // Maharashtra; a format-valid example, not the platform's
  SUPPLIER_LEGAL_NAME: 'Test Supplier Pvt Ltd',
  SUPPLIER_ADDRESS: '1 Test Road, Mumbai 400001',
  SAC_CODE: 'TEST-SAC',
  GST_RATE_BPS: '1800',
  DEFAULT_ROYALTY_RATE_BPS: '7000',
  // Test values only, not the [CA] figures.
  TDS_RATE_BPS: '1000',
  TDS_RATE_NO_PAN_BPS: '2000',
  TDS_FY_THRESHOLD_PAISE: '3000000',
  RCM_ON_UNREGISTERED_SELLERS: 'true',
  PAYOUT_MIN_PAISE: '10000',
  PAYOUT_DAY_OF_MONTH: '5',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
